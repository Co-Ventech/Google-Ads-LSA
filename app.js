
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const qs = require('querystring');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ===== ENVIRONMENT VARIABLES =====
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_ADS_CUSTOMER_ID,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  LINDY_WEBHOOK_URL,
  POLL_INTERVAL_MINUTES,
  POLL_BACK_MINUTES,
  ADD_PHONE_LEADS
} = process.env;

// ===== MONITORING CONFIGURATION =====
const MONITORING_CONFIG = {
  intervalMinutes: parseInt(process.env.MONITOR_INTERVAL_MINUTES) || 10,
  stuckThresholdMinutes: parseInt(process.env.MONITOR_STUCK_THRESHOLD_MINUTES) || 10,
  maxMessageAgeMinutes: parseInt(process.env.MONITOR_MAX_MESSAGE_AGE_MINUTES) || 15,
  lookbackMinutes: parseInt(process.env.MONITOR_LOOKBACK_MINUTES) || 250
};

// ===== TOKEN MANAGEMENT =====
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

// ===== TIME FUNCTIONS =====
function getCurrentEdtTime() {
  const now = new Date();
  const edtFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = edtFormatter.formatToParts(now);
  const dateParts = {};
  parts.forEach(part => {
    if (part.type !== 'literal') {
      dateParts[part.type] = part.value;
    }
  });
  
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}T${dateParts.hour}:${dateParts.minute}:${dateParts.second}-04:00`;
}

function getCurrentEdtTimeFormatted() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }) + ' EDT';
}

function getCurrentTimestamp() {
  return Date.now();
}

function getCalendarParameters(daysAhead = 3) {
  const currentTimestamp = getCurrentTimestamp();
  const startDate = currentTimestamp;
  const endDate = currentTimestamp + (daysAhead * 24 * 60 * 60 * 1000);
  
  return {
    startDate: startDate,
    endDate: endDate,
    startDateISO: new Date(startDate).toISOString(),
    endDateISO: new Date(endDate).toISOString(),
    timezone: 'America/New_York'
  };
}

async function getGoogleAccessToken() {
  const now = Date.now();
  
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60000) {
    console.log('✅ Using cached access token');
    return tokenCache.accessToken;
  }

  console.log('🔄 Auto-generating new Google access token...');
  
  try {
    const response = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    tokenCache.accessToken = response.data.access_token;
    tokenCache.expiresAt = now + (response.data.expires_in * 1000);
    
    console.log(`✅ New access token generated successfully`);
    return tokenCache.accessToken;
    
  } catch (error) {
    console.error('❌ Failed to generate access token:', error.response?.data || error.message);
    throw new Error(`Token generation failed: ${error.response?.data?.error_description || error.message}`);
  }
}

// ===== FETCH LEADS WITH FULL CONVERSATION HISTORY =====
async function fetchLSALeadsWithConversationHistory(minutes) {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - minutes * 60 * 1000);
  
  console.log(`🔍 Fetching LSA leads + full conversation history for last ${minutes} minutes`);
  
  const accessToken = await getGoogleAccessToken();
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json'
  };
  
  if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  }

  const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
  try {
    const conversationQuery = `
      SELECT 
        local_services_lead_conversation.id,
        local_services_lead_conversation.lead,
        local_services_lead_conversation.event_date_time,
        local_services_lead_conversation.conversation_channel,
        local_services_lead_conversation.participant_type,
        local_services_lead_conversation.message_details.text,
        local_services_lead_conversation.message_details.attachment_urls,
        local_services_lead_conversation.phone_call_details.call_duration_millis,
        local_services_lead_conversation.phone_call_details.call_recording_url
      FROM local_services_lead_conversation 
      ORDER BY local_services_lead_conversation.event_date_time DESC
      LIMIT 2000
    `;
    
    const conversationResponse = await axios.post(url, { query: conversationQuery }, { headers });
    const allConversations = conversationResponse.data.results || [];
    
    const conversationsByLead = {};
    const recentActivityLeads = new Set();
    
    allConversations.forEach(conv => {
      const conversation = conv.localServicesLeadConversation;
      const leadResourceName = conversation.lead;
      const leadId = leadResourceName.split('/').pop();
      const eventTime = new Date(conversation.eventDateTime);
      
      if (!conversationsByLead[leadId]) {
        conversationsByLead[leadId] = [];
      }
      
      conversationsByLead[leadId].push({
        id: conversation.id,
        eventDateTime: conversation.eventDateTime,
        channel: conversation.conversationChannel,
        participantType: conversation.participantType,
        messageText: conversation.messageDetails?.text || '',
        attachmentUrls: conversation.messageDetails?.attachmentUrls || [],
        callDuration: conversation.phoneCallDetails?.callDurationMillis || null,
        callRecordingUrl: conversation.phoneCallDetails?.callRecordingUrl || null
      });
      
      if (eventTime >= cutoffTime) {
        recentActivityLeads.add(leadId);
      }
    });
    
    console.log(`📊 Found conversations for ${Object.keys(conversationsByLead).length} leads, ${recentActivityLeads.size} with recent activity`);
    
    const leadQuery = `
      SELECT 
        local_services_lead.lead_type,
        local_services_lead.category_id, 
        local_services_lead.service_id,
        local_services_lead.contact_details,
        local_services_lead.lead_status,
        local_services_lead.creation_date_time,
        local_services_lead.locale,
        local_services_lead.lead_charged,
        local_services_lead.credit_details.credit_state,
        local_services_lead.credit_details.credit_state_last_update_date_time,
        local_services_lead.id,
        local_services_lead.resource_name
      FROM local_services_lead 
      ORDER BY local_services_lead.creation_date_time DESC
      LIMIT 500
    `;
    
    const leadResponse = await axios.post(url, { query: leadQuery }, { headers });
    const allLeads = leadResponse.data.results || [];
    
    console.log(`📊 Found ${allLeads.length} total leads`);
    
    const enrichedLeads = [];
    const currentTimestamp = getCurrentTimestamp();
    const currentEdtTime = getCurrentEdtTime();
    const currentEdtTimeFormatted = getCurrentEdtTimeFormatted();
    const calendarParams = getCalendarParameters(3);
    
    for (const result of allLeads) {
      const lead = result.localServicesLead;
      const createdTime = new Date(lead.creationDateTime);
      const leadConversations = conversationsByLead[lead.id] || [];
      
      const latestConversationTime = leadConversations.length > 0 
        ? new Date(Math.max(...leadConversations.map(c => new Date(c.eventDateTime))))
        : createdTime;
      
      const isNewLead = createdTime >= cutoffTime;
      const hasRecentActivity = recentActivityLeads.has(lead.id);
      
      if (isNewLead || hasRecentActivity) {
        const includePhoneLeads = ADD_PHONE_LEADS === 'true';
        if (lead.leadType === 'PHONE_CALL' && !includePhoneLeads) {
          console.log(`⏭️ Skipping phone lead ${lead.id}`);
          continue;
        }
        
        const latestConsumerMessage = leadConversations
          .filter(c => c.participantType === 'CONSUMER')
          .sort((a, b) => new Date(b.eventDateTime) - new Date(a.eventDateTime))[0];
        
        const messageText = latestConsumerMessage?.messageText || 
                           (lead.leadType === 'MESSAGE' ? 'Message content not available' : 
                            lead.leadType === 'PHONE_CALL' ? 'Phone call inquiry' :
                            `${lead.leadType} inquiry`);

        const contactDetails = lead.contactDetails || {};
        
        const enrichedLead = {
          leadId: lead.id,
          leadType: lead.leadType,
          leadStatus: lead.leadStatus,
          messageText: messageText,
          
          timing: {
            creationDateTime: lead.creationDateTime,
            lastActivityDateTime: latestConversationTime.toISOString(),
            creditStateLastUpdateDateTime: lead.creditDetails?.creditStateLastUpdateDateTime || null,
            isNewLead: isNewLead,
            hasRecentActivity: hasRecentActivity,
            currentEdtTime: currentEdtTime,
            currentEdtTimeFormatted: currentEdtTimeFormatted,
            currentTimestamp: currentTimestamp
          },
          
          calendarParams: calendarParams,
          
          conversationHistory: {
            totalConversations: leadConversations.length,
            conversations: leadConversations.sort((a, b) => new Date(a.eventDateTime) - new Date(b.eventDateTime))
          },
          
          leadDetails: {
            categoryId: lead.categoryId,
            serviceId: lead.serviceId,
            locale: lead.locale,
            leadCharged: lead.leadCharged,
            creditState: lead.creditDetails?.creditState || null
          },
          
          contactInfo: {
            name: contactDetails.consumerName || '',
            phone: contactDetails.phoneNumber || '',
            email: contactDetails.email || ''
          },
          
          ghlContactData: {
            locationId: process.env.GHL_LOCATION_ID || 'uVlhM6VHsupswi3yUiOZ',
            firstName: contactDetails.consumerName || '',
            lastName: '',
            email: contactDetails.email || '',
            phone: contactDetails.phoneNumber || '',
            tags: ['google lsa message lead', lead.leadType === 'MESSAGE' ? 'message-inquiry' : 'phone-inquiry'],
            source: 'Google LSA',
            customFields: [
              { id: 'LEAD_ID', field_value: lead.id },
              { id: 'MESSAGE', field_value: messageText },
              { id: 'LEAD_STATUS', field_value: lead.leadStatus },
              { id: 'CREATION_TIME', field_value: lead.creationDateTime },
              { id: 'LAST_ACTIVITY', field_value: latestConversationTime.toISOString() },
              { id: 'TOTAL_CONVERSATIONS', field_value: leadConversations.length.toString() },
              { id: 'CURRENT_EDT_TIME', field_value: currentEdtTime },
              { id: 'CALENDAR_START_DATE', field_value: calendarParams.startDate.toString() },
              { id: 'CALENDAR_END_DATE', field_value: calendarParams.endDate.toString() }
            ]
          }
        };
        
        enrichedLeads.push(enrichedLead);
        
        if (hasRecentActivity && !isNewLead) {
          console.log(`🔄 Including lead ${lead.id} due to recent conversation activity (${leadConversations.length} total conversations)`);
        }
      }
    }
    
    console.log(`🎯 Processed ${enrichedLeads.length} leads`);
    
    return {
      success: true,
      leads: enrichedLeads,
      count: enrichedLeads.length,
      totalLeadsChecked: allLeads.length,
      recentActivityCount: recentActivityLeads.size
    };
    
  } catch (error) {
    console.error('❌ Error fetching leads:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      leads: [],
      count: 0
    };
  }
}

// ===== SEND TO LINDY =====
async function sendToLindy(payload) {
  if (!LINDY_WEBHOOK_URL) {
    console.warn('⚠️ Lindy webhook URL not configured');
    return { success: false, error: 'Webhook URL not configured' };
  }

  if (payload.conversationHistory && payload.conversationHistory.conversations.length > 0) {
    const lastMessage = payload.conversationHistory.conversations[payload.conversationHistory.conversations.length - 1];
    
    if (lastMessage.participantType === 'ADVERTISER') {
      console.log(`🚫 Skipping lead ${payload.leadId} - Last message from ADVERTISER (preventing loop)`);
      return { 
        success: false, 
        leadId: payload.leadId,
        error: 'Skipped - preventing bot loop'
      };
    }
  }

  console.log(`📤 Sending lead ${payload.leadId} to Lindy`);
  console.log(`   Message: "${payload.messageText.substring(0, 100)}..."`);
  console.log(`   Current EDT: ${payload.timing.currentEdtTimeFormatted}`);

  try {
    const response = await axios.post(LINDY_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LSA-GHL-Integration/2.0'
      },
      timeout: 15000
    });
    
    console.log(`✅ Sent lead ${payload.leadId} to Lindy: ${response.status}`);
    return { 
      success: true, 
      leadId: payload.leadId,
      status: response.status
    };
    
  } catch (error) {
    console.error(`❌ Failed to send lead ${payload.leadId}:`, error.message);
    return { 
      success: false, 
      leadId: payload.leadId,
      error: error.message
    };
  }
}

// ===== MAIN POLLING FUNCTION =====
async function pollLeadsAndSendToLindy() {
  console.log(`\n🔄 Starting polling for last ${POLL_BACK_MINUTES} minutes...`);
  
  const leadsResult = await fetchLSALeadsWithConversationHistory(POLL_BACK_MINUTES);
  
  if (!leadsResult.success) {
    console.error(`❌ Failed to fetch leads: ${leadsResult.error}`);
    return {
      success: false,
      error: leadsResult.error,
      processed: 0,
      sent: 0
    };
  }
  
  if (leadsResult.count === 0) {
    console.log(`📭 No leads found in last ${POLL_BACK_MINUTES} minutes`);
    return {
      success: true,
      processed: 0,
      sent: 0,
      message: 'No leads found'
    };
  }
  
  console.log(`📬 Processing ${leadsResult.count} leads...`);
  
  const lindyResults = [];
  
  for (const lead of leadsResult.leads) {
    const result = await sendToLindy(lead);
    lindyResults.push(result);
  }
  
  const sentCount = lindyResults.filter(r => r.success).length;
  
  console.log(`✅ Processing complete: ${sentCount}/${leadsResult.count} sent to Lindy\n`);
  
  return {
    success: true,
    processed: leadsResult.count,
    sent: sentCount,
    leadsData: leadsResult.leads,
    lindyResults: lindyResults,
    timestamp: new Date().toISOString()
  };
}

// // ===== NEW: MONITORING FUNCTION =====
// async function monitorStuckConversations() {
//   console.log('\n🔍 ========================================');
//   console.log('🔍 MONITORING: Checking for stuck workflows...');
//   console.log('🔍 ========================================');
  
//   const { sendStuckLeadAlert } = require('./emailService');
  
//   const leadsResult = await fetchLSALeadsWithConversationHistory(MONITORING_CONFIG.lookbackMinutes);
  
//   if (!leadsResult.success || leadsResult.count === 0) {
//     console.log('📭 No leads to monitor');
//     return { success: true, stuckLeads: [], checked: 0 };
//   }
  
//   const stuckLeads = [];
//   const now = Date.now();
//   const STUCK_THRESHOLD_MS = MONITORING_CONFIG.stuckThresholdMinutes * 60 * 1000;
//   const MAX_MESSAGE_AGE_MS = MONITORING_CONFIG.maxMessageAgeMinutes * 60 * 1000;
  
//   for (const lead of leadsResult.leads) {
//     const conversations = lead.conversationHistory.conversations;
    
//     if (conversations.length === 0) continue;
    
//     const lastMessage = conversations[conversations.length - 1];
//     const lastMessageTime = new Date(lastMessage.eventDateTime).getTime();
//     const minutesSinceLastMessage = Math.floor((now - lastMessageTime) / 60000);
//     const timeDiff = now - lastMessageTime;
    
//     // Skip old messages (prevents false alerts on 240-minute-old messages)
//     if (timeDiff > MAX_MESSAGE_AGE_MS) {
//       console.log(`⏭️ Skipping lead ${lead.leadId} - Message too old (${minutesSinceLastMessage} min)`);
//       continue;
//     }
    
//     if (lastMessage.participantType === 'CONSUMER' && timeDiff > STUCK_THRESHOLD_MS) {
//       console.log(`🚨 STUCK LEAD DETECTED: ${lead.leadId}`);
//       console.log(`   ├─ Customer: ${lead.contactInfo.name || 'Unknown'}`);
//       console.log(`   ├─ Phone: ${lead.contactInfo.phone || 'N/A'}`);
//       console.log(`   ├─ Waiting: ${minutesSinceLastMessage} minutes`);
//       console.log(`   └─ Message: "${lastMessage.messageText.substring(0, 60)}..."`);
      
//       stuckLeads.push({
//         ...lead,
//         minutesSinceLastMessage: minutesSinceLastMessage,
//         lastMessageFrom: lastMessage.participantType,
//         lastMessageText: lastMessage.messageText,
//         lastMessageTime: lastMessage.eventDateTime
//       });
//     }
//   }
  
//   console.log(`\n📊 Monitoring Results:`);
//   console.log(`   Total leads checked: ${leadsResult.count}`);
//   console.log(`   Stuck leads found: ${stuckLeads.length}`);
  
//   if (stuckLeads.length > 0) {
//     console.log(`\n📧 Sending email alert for ${stuckLeads.length} stuck lead(s)...`);
    
//     const emailResult = await sendStuckLeadAlert(stuckLeads);
    
//     if (emailResult.statusCode === 200) {
//       console.log(`✅ Email alert sent successfully to: ${process.env.NOTIFICATION_EMAIL}`);
//       console.log(`   Message ID: ${emailResult.messageId}`);
//     } else {
//       console.log(`❌ Email alert failed: ${emailResult.message}`);
//     }
    
//     return {
//       success: true,
//       stuckLeads: stuckLeads,
//       checked: leadsResult.count,
//       emailSent: emailResult.statusCode === 200
//     };
    
//   } else {
//     console.log(`✅ All conversations are healthy - no alerts needed`);
    
//     return {
//       success: true,
//       stuckLeads: [],
//       checked: leadsResult.count,
//       emailSent: false,
//       message: 'All conversations healthy ✅'
//     };
//   }
// }
// ===== CORRECTED: MONITORING FUNCTION =====
async function monitorStuckConversations() {
  console.log('\n🔍 ========================================');
  console.log('🔍 MONITORING: Checking for stuck workflows...');
  console.log('🔍 ========================================');
  
  const { sendStuckLeadAlert } = require('./emailService');
  
  const leadsResult = await fetchLSALeadsWithConversationHistory(MONITORING_CONFIG.lookbackMinutes);
  
  if (!leadsResult.success || leadsResult.count === 0) {
    console.log('📭 No leads to monitor');
    return { success: true, stuckLeads: [], checked: 0 };
  }
  
  const stuckLeads = [];
  const now = Date.now();
  const STUCK_THRESHOLD_MS = MONITORING_CONFIG.stuckThresholdMinutes * 60 * 1000;
  
  for (const lead of leadsResult.leads) {
    const conversations = lead.conversationHistory.conversations;
    
    if (conversations.length === 0) continue;
    
    // ✅ FIND THE LAST CONSUMER MESSAGE (not the last message overall)
    const lastConsumerMessage = conversations
      .slice()
      .reverse()
      .find(c => c.participantType === 'CONSUMER');
    
    if (!lastConsumerMessage) {
      console.log(`⏭️ Skipping lead ${lead.leadId} - No consumer messages found`);
      continue;
    }
    
    const lastConsumerMessageTime = new Date(lastConsumerMessage.eventDateTime).getTime();
    const minutesSinceLastConsumerMessage = Math.floor((now - lastConsumerMessageTime) / 60000);
    const timeDiff = now - lastConsumerMessageTime;
    
    // ✅ CHECK: Has it been > 10 minutes since the LAST CONSUMER message?
    if (timeDiff > STUCK_THRESHOLD_MS) {
      
      // ✅ NOW check if there's an AI response AFTER that consumer message
      const hasAIResponseAfterConsumer = conversations
        .filter(c => new Date(c.eventDateTime).getTime() > lastConsumerMessageTime)
        .some(c => c.participantType === 'ADVERTISER');
      
      // ✅ ONLY alert if: Consumer message is old AND NO AI response after it
      if (!hasAIResponseAfterConsumer) {
        console.log(`🚨 STUCK LEAD DETECTED: ${lead.leadId}`);
        console.log(`   ├─ Customer: ${lead.contactInfo.name || 'Unknown'}`);
        console.log(`   ├─ Phone: ${lead.contactInfo.phone || 'N/A'}`);
        console.log(`   ├─ Waiting: ${minutesSinceLastConsumerMessage} minutes`);
        console.log(`   ├─ Last Consumer Message: "${lastConsumerMessage.messageText.substring(0, 60)}..."`);
        console.log(`   └─ Last Consumer Message Time: ${new Date(lastConsumerMessage.eventDateTime).toLocaleString('en-US', { timeZone: 'America/New_York' })} EDT`);
        
        stuckLeads.push({
          ...lead,
          minutesSinceLastMessage: minutesSinceLastConsumerMessage,
          lastMessageFrom: 'CONSUMER',
          lastMessageText: lastConsumerMessage.messageText,
          lastMessageTime: lastConsumerMessage.eventDateTime,
          hasAIResponse: false
        });
      } else {
        console.log(`✅ Lead ${lead.leadId} - AI already responded (${minutesSinceLastConsumerMessage} min ago, but response received)`);
      }
    }
  }
  
  console.log(`\n📊 Monitoring Results:`);
  console.log(`   Total leads checked: ${leadsResult.count}`);
  console.log(`   Stuck leads found: ${stuckLeads.length}`);
  
  if (stuckLeads.length > 0) {
    console.log(`\n📧 Sending email alert for ${stuckLeads.length} stuck lead(s)...`);
    
    const emailResult = await sendStuckLeadAlert(stuckLeads);
    
    if (emailResult.statusCode === 200) {
      console.log(`✅ Email alert sent successfully to: ${process.env.NOTIFICATION_EMAIL}`);
      console.log(`   Message ID: ${emailResult.messageId}`);
    } else {
      console.log(`❌ Email alert failed: ${emailResult.message}`);
    }
    
    return {
      success: true,
      stuckLeads: stuckLeads,
      checked: leadsResult.count,
      emailSent: emailResult.statusCode === 200
    };
    
  } else {
    console.log(`✅ All conversations are healthy - no alerts needed`);
    
    return {
      success: true,
      stuckLeads: [],
      checked: leadsResult.count,
      emailSent: false,
      message: 'All conversations healthy ✅'
    };
  }
}

// ===== API ENDPOINTS =====

app.get('/api/poll-now', async (req, res) => {
  try {
    const result = await pollLeadsAndSendToLindy();
    
    res.json({
      success: result.success,
      message: result.error || 'Polling completed',
      timestamp: new Date().toISOString(),
      statistics: {
        processed: result.processed,
        sentToLindy: result.sent
      },
      leadsData: result.leadsData || [],
      config: {
        pollBackMinutes: POLL_BACK_MINUTES,
        addPhoneLeads: ADD_PHONE_LEADS === 'true',
        webhookConfigured: !!LINDY_WEBHOOK_URL,
        calendarDaysAhead: 3
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// NEW: Monitoring endpoint
app.get('/api/monitor-stuck', async (req, res) => {
  try {
    console.log('\n🔍 Manual monitoring check triggered via API...\n');
    const result = await monitorStuckConversations();
    
    res.json({
      success: result.success,
      message: result.message || `Monitoring completed`,
      timestamp: new Date().toISOString(),
      statistics: {
        totalChecked: result.checked,
        stuckLeadsFound: result.stuckLeads.length,
        emailSent: result.emailSent
      },
      stuckLeads: result.stuckLeads.map(lead => ({
        leadId: lead.leadId,
        customerName: lead.contactInfo.name || 'Unknown',
        phone: lead.contactInfo.phone || 'N/A',
        minutesWaiting: lead.minutesSinceLastMessage,
        lastMessage: lead.lastMessageText.substring(0, 100) + '...',
        lastActivity: lead.timing.lastActivityDateTime
      })),
      config: {
        threshold: `${MONITORING_CONFIG.stuckThresholdMinutes} minutes`,
  checkInterval: `${MONITORING_CONFIG.intervalMinutes} minutes`,
  maxMessageAge: `${MONITORING_CONFIG.maxMessageAgeMinutes} minutes`,
  lookbackMinutes: MONITORING_CONFIG.lookbackMinutes,
  emailAlertsEnabled: true
      }
    });
    
  } catch (error) {
    console.error('❌ Monitoring API error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/proxy-calendar-slots-auto', async (req, res) => {
  console.log('📅 Auto-proxy called');
  
  const currentTimestamp = Date.now();
  const startDate = currentTimestamp;
  const endDate = currentTimestamp + (3 * 24 * 60 * 60 * 1000);
  
  const calendarId = req.query.calendarId;
  const authToken = process.env.GHL_ACCESS_TOKEN;
  
  console.log(`🔢 Using timestamps: startDate=${startDate}, endDate=${endDate}`);
  
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`,
      {
        params: {
          startDate: startDate,
          endDate: endDate
        },
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'Version': '2021-04-15'
        }
      }
    );
    
    console.log('✅ Calendar slots retrieved');
    res.json(response.data);
    
  } catch (error) {
    console.error('❌ GHL API error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || { message: error.message }
    });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const accessToken = await getGoogleAccessToken();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      features: [
        'Enhanced conversation history tracking',
        'Detailed timing information',
        'Current EDT time for slot validation',
        'Calendar parameters for 4-day range',
        'Full webhook payload with conversation data',
        'Bot loop prevention',
        `🆕 Stuck lead monitoring (${MONITORING_CONFIG.stuckThresholdMinutes}-minute threshold)`,  // ← DYNAMIC
        '🆕 Email alerts for missed responses'
      ],
      config: {
        pollIntervalMinutes: POLL_INTERVAL_MINUTES,
  pollBackMinutes: POLL_BACK_MINUTES,
  addPhoneLeads: ADD_PHONE_LEADS === 'true',
  hasGoogleCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
  hasLindyWebhook: !!LINDY_WEBHOOK_URL,
  customerId: GOOGLE_ADS_CUSTOMER_ID,
  calendarDaysAhead: 3,
  monitoring: {  // ← ADD THIS
    enabled: true,
    intervalMinutes: MONITORING_CONFIG.intervalMinutes,
    stuckThresholdMinutes: MONITORING_CONFIG.stuckThresholdMinutes,
    maxMessageAgeMinutes: MONITORING_CONFIG.maxMessageAgeMinutes,
    lookbackMinutes: MONITORING_CONFIG.lookbackMinutes
  }
      },
      tokenSystem: {
        status: 'working',
        hasValidToken: !!accessToken
      }
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// ===== CRON JOBS =====

if (process.env.NODE_ENV !== 'test') {
  // Existing polling cron (every 2 minutes, looks back 242 minutes)
  cron.schedule(`*/${POLL_INTERVAL_MINUTES} * * * *`, async () => {
    console.log(`🕐 Automated ${POLL_INTERVAL_MINUTES}-minute polling triggered...`);
    try {
      await pollLeadsAndSendToLindy();
    } catch (error) {
      console.error('❌ Cron job failed:', error.message);
    }
  });
  console.log(`⏰ Polling cron scheduled: Every ${POLL_INTERVAL_MINUTES} minutes (looking back ${POLL_BACK_MINUTES} min)`);
  
  // NEW: Monitoring cron (every 10 minutes, looks back 60 minutes)
  cron.schedule(`*/${MONITORING_CONFIG.intervalMinutes} * * * *`, async () => {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🔍 AUTOMATED MONITORING CHECK');
    console.log(`⏰ Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EDT`);
    console.log('═══════════════════════════════════════════════════════');
    
    try {
      const result = await monitorStuckConversations();
      
      console.log('\n📋 MONITORING SUMMARY:');
      console.log(`   ├─ Leads Checked: ${result.checked}`);
      console.log(`   ├─ Stuck Leads: ${result.stuckLeads.length}`);
      console.log(`   └─ Email Sent: ${result.emailSent ? 'YES ✅' : 'NO ⏸️'}`);
      
      if (result.stuckLeads.length > 0) {
        console.log('\n🚨 ALERT: Email notification sent');
        console.log(`   Recipient: ${process.env.NOTIFICATION_EMAIL}`);
        result.stuckLeads.forEach(lead => {
          console.log(`   • Lead ${lead.leadId}: ${lead.minutesSinceLastMessage} min wait`);
        });
      }
      
      console.log('═══════════════════════════════════════════════════════\n');
      
    } catch (error) {
      console.error('❌ [MONITORING ERROR]:', error.message);
      console.log('═══════════════════════════════════════════════════════\n');
    }
  });
  
  console.log(`⏰ Monitoring cron scheduled: Every ${MONITORING_CONFIG.intervalMinutes} minutes (checking last ${MONITORING_CONFIG.lookbackMinutes} min for stuck leads)\n`);
}

// ===== START SERVER =====

app.listen(PORT, () => {
  console.log(`\n🚀 LSA-to-Lindy Integration Server running on http://localhost:${PORT}`);
  console.log(`📊 Customer ID: ${GOOGLE_ADS_CUSTOMER_ID}`);
  console.log(`🔗 Lindy Webhook: ${LINDY_WEBHOOK_URL ? 'Configured ✅' : 'Not configured ❌'}`);
  console.log(`⚙️ Config: Poll every ${POLL_INTERVAL_MINUTES}min, fetch last ${POLL_BACK_MINUTES}min`);
  console.log(`\n🎯 Features:`);
  console.log(`   ✅ Current EDT time for AI slot validation`);
  console.log(`   ✅ 4-day calendar range (weekend filtering)`);
  console.log(`   ✅ Full conversation history tracking`);
  console.log(`   ✅ Bot loop prevention`);
  console.log(`   ✅ Stuck lead monitoring (${MONITORING_CONFIG.stuckThresholdMinutes}-minute threshold)`);
  console.log(`   ✅ Email alerts for missed responses`);
  console.log(`\n📋 API Endpoints:`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   GET  http://localhost:${PORT}/api/poll-now`);
  console.log(`   GET  http://localhost:${PORT}/api/monitor-stuck`);
});

module.exports = app;
