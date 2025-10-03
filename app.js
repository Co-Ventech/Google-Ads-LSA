
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const qs = require('querystring');

const app = express();
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

function getCalendarParameters(daysAhead = 4) {
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
    // Step 1: Get ALL conversation history
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
    
    // Group conversations by lead
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
    
    // Step 2: Get all leads
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
    
    // Step 3: Filter and enrich leads
    const enrichedLeads = [];
    const currentTimestamp = getCurrentTimestamp();
    const currentEdtTime = getCurrentEdtTime();
    const currentEdtTimeFormatted = getCurrentEdtTimeFormatted();
    const calendarParams = getCalendarParameters(4);
    
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

  // Bot loop prevention
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
        calendarDaysAhead: 4
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
        'Bot loop prevention'
      ],
      config: {
        pollIntervalMinutes: POLL_INTERVAL_MINUTES,
        pollBackMinutes: POLL_BACK_MINUTES,
        addPhoneLeads: ADD_PHONE_LEADS === 'true',
        hasGoogleCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
        hasLindyWebhook: !!LINDY_WEBHOOK_URL,
        customerId: GOOGLE_ADS_CUSTOMER_ID,
        calendarDaysAhead: 4
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

// ===== CRON JOB =====

if (process.env.NODE_ENV !== 'test') {
  cron.schedule(`*/${POLL_INTERVAL_MINUTES} * * * *`, async () => {
    console.log(`🕐 Automated ${POLL_INTERVAL_MINUTES}-minute polling triggered...`);
    try {
      await pollLeadsAndSendToLindy();
    } catch (error) {
      console.error('❌ Cron job failed:', error.message);
    }
  });
  
  console.log(`⏰ Cron job scheduled: Every ${POLL_INTERVAL_MINUTES} minutes`);
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
  console.log(`\n📋 API Endpoints:`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   GET  http://localhost:${PORT}/api/poll-now`);
});

module.exports = app;
