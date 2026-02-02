require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const qs = require('querystring');
const cors = require('cors');
const { monitorStuckConversations } = require('./Monitoringservice');
const { computeNextAction } = require('./CallStateService'); // If it's an object
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
let callData = {};

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
  stuckThresholdMinutes: parseInt(process.env.MONITOR_STUCK_THRESHOLD_MINUTES) || 15,
  maxMessageAgeMinutes: parseInt(process.env.MONITOR_MAX_MESSAGE_AGE_MINUTES) || 60,
  lookbackMinutes: parseInt(process.env.MONITOR_LOOKBACK_MINUTES) || 250,
  timezoneOffsetMinutes: parseInt(process.env.POLL_BACK_MINUTES) - parseInt(process.env.POLL_INTERVAL_MINUTES) || 300
};

// ===== TOKEN MANAGEMENT =====
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

// ===== TIME FUNCTIONS =====

function getServerTimezoneOffset() {
  return new Date().getTimezoneOffset();
}

function getMinutesSinceGoogleTimestamp(googleTimestamp) {
  const messageTime = new Date(googleTimestamp).getTime();
  const now = Date.now();
  const diffMs = now - messageTime;
  const diffMinutes = Math.floor(diffMs / 60000);
  return diffMinutes;
}

function parseGoogleTimestamp(googleTimestamp) {
  const utcDate = new Date(googleTimestamp);
  const localDate = new Date(utcDate.toLocaleString('en-US', { timeZone: process.env.TIME_ZONE || 'America/New_York' }));

  return {
    utcTime: utcDate.toISOString(),
    localTime: localDate.toLocaleString('en-US', { timeZone: process.env.TIME_ZONE || 'America/New_York' }),
    timestamp: utcDate.getTime(),
    minutesAgo: getMinutesSinceGoogleTimestamp(googleTimestamp)
  };
}

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  NEW FUNCTION: Parse Google Ads timestamp correctly                           ║
// ║  Google returns "YYYY-MM-DD HH:MM:SS" in ACCOUNT's timezone (no indicator)    ║
// ║  We need to interpret it as account timezone, then convert to UTC for math    ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝
function parseGoogleAdsTimestamp(googleTimestamp, accountTimezone) {
  // Google returns: "2025-12-03 01:59:08" (in account timezone, NO timezone indicator)
  // JavaScript's new Date() would wrongly interpret this as UTC/local server time

  if (!googleTimestamp) return null;

  const tz = accountTimezone || process.env.TIME_ZONE || 'America/New_York';

  // Handle ISO format (already has timezone info like "Z" or "+00:00")
  if (googleTimestamp.includes('T') && (googleTimestamp.includes('Z') || googleTimestamp.includes('+') || googleTimestamp.match(/-\d{2}:\d{2}$/))) {
    return new Date(googleTimestamp).getTime();
  }

  // For Google Ads format "YYYY-MM-DD HH:MM:SS" (no timezone indicator)
  // This timestamp is in the ACCOUNT's timezone

  // Get the timezone offset for the account timezone
  const now = new Date();

  // Create formatter for the account timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Get current time in both UTC and account timezone to calculate offset
  const utcNow = new Date();
  const utcString = utcNow.toISOString().slice(0, 19).replace('T', ' ');

  const tzParts = formatter.formatToParts(utcNow);
  const tzObj = {};
  tzParts.forEach(p => { if (p.type !== 'literal') tzObj[p.type] = p.value; });
  const tzString = `${tzObj.year}-${tzObj.month}-${tzObj.day} ${tzObj.hour}:${tzObj.minute}:${tzObj.second}`;

  // Calculate offset: how many ms ahead/behind is the timezone from UTC
  const utcMs = new Date(utcString.replace(' ', 'T') + 'Z').getTime();
  const tzMs = new Date(tzString.replace(' ', 'T') + 'Z').getTime();
  const offsetMs = tzMs - utcMs;

  // Parse the Google timestamp as if it were UTC
  const googleMs = new Date(googleTimestamp.replace(' ', 'T') + 'Z').getTime();

  // Convert to actual UTC by subtracting the offset
  // If timezone is EST (UTC-5), offset is negative (-18000000ms)
  // Google says "01:59 EST" = 01:59 + 5 hours = 06:59 UTC
  const actualUtcMs = googleMs - offsetMs;

  return actualUtcMs;
}

/**
 * Calculate ACTUAL minutes since a Google Ads timestamp
 * This correctly handles the timezone issue
 */
function getActualMinutesSinceGoogleTimestamp(googleTimestamp, accountTimezone) {
  const actualUtcMs = parseGoogleAdsTimestamp(googleTimestamp, accountTimezone);
  if (!actualUtcMs) return 0;

  const now = Date.now();
  const diffMs = now - actualUtcMs;
  const diffMinutes = Math.floor(diffMs / 60000);

  return Math.max(0, diffMinutes);
}

function getCurrentEdtTime() {
  const now = new Date();
  const edtFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.TIME_ZONE,
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
    timeZone: process.env.TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function getCurrentTimestamp() {
  return Date.now();
}

function getCalendarParameters(daysAhead = 10) {
  const currentTimestamp = getCurrentTimestamp();
  const startDate = currentTimestamp;
  const endDate = currentTimestamp + (daysAhead * 24 * 60 * 60 * 1000);

  return {
    startDate: startDate,
    endDate: endDate,
    startDateISO: new Date(startDate).toISOString(),
    endDateISO: new Date(endDate).toISOString(),
    timezone: process.env.TIME_ZONE
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
// NOTE: This function is NOT changed - it works correctly with POLL_BACK_MINUTES
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
      LIMIT 250
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
      LIMIT 250
    `;

    const leadResponse = await axios.post(url, { query: leadQuery }, { headers });
    const allLeads = leadResponse.data.results || [];

    console.log(`📊 Found ${allLeads.length} total leads`);

    const enrichedLeads = [];
    const currentTimestamp = getCurrentTimestamp();
    const currentEdtTime = getCurrentEdtTime();
    const currentEdtTimeFormatted = getCurrentEdtTimeFormatted();
    const calendarParams = getCalendarParameters(10);

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
            currentTime: currentEdtTime,
            currentTimeFormatted: currentEdtTimeFormatted,
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
              { id: 'CURRENT_TIME', field_value: currentEdtTime },
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
// NOTE: This function is NOT changed
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
  console.log(`   Current: ${payload.timing.currentEdtTimeFormatted}`);

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
// NOTE: This function is NOT changed
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

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  FIXED MONITORING FUNCTION - Correct timezone handling                        ║
// ║  CHANGES:                                                                      ║
// ║  1. Uses getActualMinutesSinceGoogleTimestamp() for correct time calculation  ║
// ║  2. Properly interprets Google's account-timezone timestamps                  ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝
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
//   const accountTimezone = process.env.TIME_ZONE || 'America/New_York';

//   console.log(`\n🔍 Checking ${leadsResult.count} leads for stuck conversations...`);
//   console.log(`   Stuck threshold: ${MONITORING_CONFIG.stuckThresholdMinutes} minutes`);
//   console.log(`   Account timezone: ${accountTimezone}`);
//   console.log(`   Server time (UTC): ${new Date().toISOString()}`);
//   console.log(`   Server time (${accountTimezone}): ${new Date().toLocaleString('en-US', { timeZone: accountTimezone })}\n`);

//   for (const lead of leadsResult.leads) {
//     const conversations = lead.conversationHistory.conversations;

//     if (conversations.length === 0) {
//       console.log(`⏭️ Lead ${lead.leadId}: No conversations`);
//       continue;
//     }

//     const lastMessage = conversations[conversations.length - 1];

//     if (!lastMessage) {
//       console.log(`⏭️ Lead ${lead.leadId}: No messages found`);
//       continue;
//     }

//     // ╔═══════════════════════════════════════════════════════════════════════════╗
//     // ║  FIX: Use the new function that correctly handles timezone               ║
//     // ╚═══════════════════════════════════════════════════════════════════════════╝
//     const minutesSinceLastMessage = getActualMinutesSinceGoogleTimestamp(
//       lastMessage.eventDateTime, 
//       accountTimezone
//     );

//     console.log(`\n📋 Lead ${lead.leadId}: ${conversations.length} messages total`);
//     console.log(`   Last message from: ${lastMessage.participantType}`);
//     console.log(`   Google timestamp (account tz): ${lastMessage.eventDateTime}`);
//     console.log(`   ⏱️ ACTUAL minutes since message: ${minutesSinceLastMessage} min`);
//     console.log(`   Threshold: ${MONITORING_CONFIG.stuckThresholdMinutes} min`);

//     // CHECK 1: Is the last message from CONSUMER?
//     if (lastMessage.participantType !== 'CONSUMER') {
//       console.log(`   ✅ SKIP: Last message is from ${lastMessage.participantType} - AI responded`);
//       continue;
//     }

//     console.log(`   ✓ Check 1 passed: Last message IS from CONSUMER`);

//     // CHECK 2: Have threshold minutes passed? (NOW USING CORRECT CALCULATION)
//     if (minutesSinceLastMessage < MONITORING_CONFIG.stuckThresholdMinutes) {
//       console.log(`   ✅ SKIP: Only ${minutesSinceLastMessage} min passed (need ${MONITORING_CONFIG.stuckThresholdMinutes} min)`);
//       continue;
//     }

//     console.log(`   ✓ Check 2 passed: ${minutesSinceLastMessage} >= ${MONITORING_CONFIG.stuckThresholdMinutes}`);

//     // CHECK 3: Skip very old messages
//     if (minutesSinceLastMessage > MONITORING_CONFIG.maxMessageAgeMinutes) {
//       console.log(`   ⏭️ SKIP: Message too old (${minutesSinceLastMessage} min > ${MONITORING_CONFIG.maxMessageAgeMinutes} max)`);
//       continue;
//     }

//     // All checks passed: This is a genuinely stuck lead
//     console.log(`🚨 STUCK LEAD DETECTED: ${lead.leadId}`);
//     console.log(`   ├─ Customer: ${lead.contactInfo.name || 'Unknown'}`);
//     console.log(`   ├─ Phone: ${lead.contactInfo.phone || 'N/A'}`);
//     console.log(`   ├─ Waiting: ${minutesSinceLastMessage} minutes (ACTUAL)`);
//     console.log(`   ├─ Last Message: "${lastMessage.messageText.substring(0, 60)}..."`);
//     console.log(`   └─ Last Message Time: ${lastMessage.eventDateTime} (${accountTimezone})`);

//     stuckLeads.push({
//       ...lead,
//       minutesSinceLastMessage: minutesSinceLastMessage,
//       lastMessageFrom: 'CONSUMER',
//       lastMessageText: lastMessage.messageText,
//       lastMessageTime: lastMessage.eventDateTime,
//       lastMessageTimeLocal: new Date(parseGoogleAdsTimestamp(lastMessage.eventDateTime, accountTimezone))
//         .toLocaleString('en-US', { timeZone: accountTimezone }),
//       hasAIResponse: false
//     });
//   }

//   console.log(`\n📊 Monitoring Results:`);
//   console.log(`   Total leads checked: ${leadsResult.count}`);
//   console.log(`   Stuck leads found: ${stuckLeads.length}`);

//   if (stuckLeads.length > 0) {
//     console.log(`\n📧 Sending email alert for ${stuckLeads.length} stuck lead(s)...`);

//     // // ===== START: AUTO-RETRY BLOCK =====
//     // console.log(`\n🔄 Re-sending ${stuckLeads.length} stuck lead(s) to Lindy for retry...`);
//     // for (const stuckLead of stuckLeads) {
//     //   const lindyResult = await sendToLindy(stuckLead);
//     //   if (lindyResult.success) {
//     //     console.log(`   ✅ Re-sent lead ${stuckLead.leadId} to Lindy`);
//     //   } else {
//     //     console.log(`   ❌ Failed to re-send lead ${stuckLead.leadId}: ${lindyResult.error}`);
//     //   }
//     // }
//     // // ===== END: AUTO-RETRY BLOCK =====

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
        calendarDaysAhead: 10
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
        lastActivity: lead.timing.lastActivityDateTime,
        lastActivityLocal: lead.lastMessageTimeLocal
      })),
      config: {
        threshold: `${MONITORING_CONFIG.stuckThresholdMinutes} minutes`,
        checkInterval: `${MONITORING_CONFIG.intervalMinutes} minutes`,
        maxMessageAge: `${MONITORING_CONFIG.maxMessageAgeMinutes} minutes`,
        lookbackMinutes: MONITORING_CONFIG.lookbackMinutes,
        emailAlertsEnabled: true,
        serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientTimezone: process.env.TIME_ZONE
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
  const endDate = currentTimestamp + (10 * 24 * 60 * 60 * 1000);

  const calendarId = req.query.calendarId;
  const authToken = process.env.GHL_ACCESS_TOKEN;

  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`,
      {
        params: { startDate, endDate },
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${authToken}`,
          Version: '2021-04-15'
        }
      }
    );

    const data = response.data;
    const formattedSlots = [];

    const ordinal = (n) => {
      if (n >= 11 && n <= 13) return 'th';
      return ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] || 'th';
    };

    const timezoneFromOffset = (offset) => {
      const map = {
        '-05:00': 'EST',
        '-06:00': 'CST',
        '-07:00': 'MST',
        '-08:00': 'PST'
      };
      return map[offset] || `UTC${offset}`;
    };

    Object.entries(data).forEach(([dateKey, value]) => {
      // ✅ Skip traceId or invalid keys
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      if (!value?.slots) return;

      value.slots.forEach((iso) => {
        // ISO example: 2026-01-21T13:30:00-05:00
        const [datePart, timeAndZone] = iso.split('T');
        const [timePart, offset] = timeAndZone.split(/([+-]\d{2}:\d{2})/);

        const [hourStr, minuteStr] = timePart.split(':');
        let hour = parseInt(hourStr, 10);
        const minute = minuteStr;

        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12 || 12;

        const dateObj = new Date(`${datePart}T00:00:00`);
        const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
        const month = dateObj.toLocaleDateString('en-US', { month: 'long' });
        const day = dateObj.getDate();

        const timezoneLabel = timezoneFromOffset(offset);

        formattedSlots.push(
          `${weekday} ${month} ${day}${ordinal(day)} at ${hour}:${minute} ${ampm} ${timezoneLabel}`
        );
      });
    });

    res.json({
      traceId: data.traceId,
      slots: formattedSlots
    });

  } catch (error) {
    console.error('❌ GHL API error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || { message: error.message }
    });
  }
});

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  GHL CALENDAR FREE SLOTS API - Flexible & Formatted                           ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

app.get('/api/get-free-slots', async (req, res) => {
  console.log('📅 GET /api/get-free-slots called');
  console.log(`📋 Query params:`, req.query);

  try {
    // Get configuration from env variables (can be overridden by query params)
    const calendarId = req.query.calendarId || process.env.PROBATE_CALENDAR_ID;
    const authToken = req.query.authToken || process.env.GHL_ACCESS_TOKEN;
    const apiVersion = req.query.apiVersion || process.env.GHL_CALENDAR_API_VERSION || '2021-04-15';

    // Validate required parameters
    if (!calendarId) {
      return res.status(400).json({
        success: false,
        error: 'Calendar ID is required. Provide via query param or GHL_CALENDAR_ID env variable.'
      });
    }

    if (!authToken) {
      return res.status(400).json({
        success: false,
        error: 'Auth token is required. Provide via query param or GHL_ACCESS_TOKEN env variable.'
      });
    }

    // Date range: Accept from query params or default to 10 days ahead
    const daysAhead = parseInt(req.query.daysAhead) || 10;
    const currentTimestamp = Date.now();
    const startDate = req.query.startDate || currentTimestamp;
    const endDate = req.query.endDate || (currentTimestamp + (daysAhead * 24 * 60 * 60 * 1000));

    console.log(`📅 Fetching slots for calendar: ${calendarId}`);
    console.log(`📅 Date range: ${new Date(parseInt(startDate)).toLocaleDateString()} - ${new Date(parseInt(endDate)).toLocaleDateString()}`);

    // Call GHL API
    const response = await axios.get(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`,
      {
        params: { startDate, endDate },
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${authToken}`,
          Version: apiVersion
        }
      }
    );

    const rawData = response.data;
    const formattedSlots = [];

    // Helper function for ordinal suffixes (1st, 2nd, 3rd, etc.)
    const getOrdinal = (n) => {
      if (n >= 11 && n <= 13) return 'th';
      const lastDigit = n % 10;
      if (lastDigit === 1) return 'st';
      if (lastDigit === 2) return 'nd';
      if (lastDigit === 3) return 'rd';
      return 'th';
    };

    // Helper function to get timezone label from offset
    const getTimezoneLabel = (offset) => {
      const timezoneMap = {
        '-05:00': 'EST',
        '-06:00': 'CST',
        '-07:00': 'MST',
        '-08:00': 'PST'
      };
      return timezoneMap[offset] || `UTC${offset}`;
    };

    // Process each date and its slots
    Object.entries(rawData).forEach(([dateKey, value]) => {
      // Skip non-date keys (like traceId)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      if (!value?.slots || !Array.isArray(value.slots)) return;

      value.slots.forEach((isoTimestamp) => {
        try {
          // Parse ISO timestamp: "2026-01-22T15:30:00-05:00"
          const [datePart, timeAndZone] = isoTimestamp.split('T');

          // Extract time and timezone offset
          const timezoneMatch = timeAndZone.match(/([+-]\d{2}:\d{2})$/);
          const offset = timezoneMatch ? timezoneMatch[1] : '-05:00';
          const timePart = timeAndZone.replace(offset, '');

          // Parse hour and minute
          const [hourStr, minuteStr] = timePart.split(':');
          let hour = parseInt(hourStr, 10);
          const minute = minuteStr;

          // Convert to 12-hour format
          const ampm = hour >= 12 ? 'PM' : 'AM';
          hour = hour % 12 || 12;

          // Parse date information
          const dateObj = new Date(`${datePart}T00:00:00`);
          const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
          const month = dateObj.toLocaleDateString('en-US', { month: 'long' });
          const day = dateObj.getDate();

          // Get timezone label
          const timezoneLabel = getTimezoneLabel(offset);

          // Format: "Tuesday January 20th at 2:00 PM EST"
          const formattedSlot = `${weekday} ${month} ${day}${getOrdinal(day)} at ${hour}:${minute} ${ampm} ${timezoneLabel}`;
          formattedSlots.push(formattedSlot);

        } catch (error) {
          console.error(`⚠️ Error parsing timestamp: ${isoTimestamp}`, error.message);
        }
      });
    });

    console.log(`✅ Formatted ${formattedSlots.length} time slots`);

    // Return formatted response
    res.json({
      success: true,
      traceId: rawData.traceId || null,
      slots: formattedSlots,
      metadata: {
        calendarId: calendarId,
        totalSlots: formattedSlots.length,
        dateRange: {
          start: new Date(parseInt(startDate)).toISOString(),
          end: new Date(parseInt(endDate)).toISOString()
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching calendar slots:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data || null
    });
  }
});

// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  CALL STATE API ENDPOINTS                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

app.post('/check-state', (req, res) => {
  console.log("=== POST /check-state hit ===");
  console.log("AI sent vars:", JSON.stringify(req.body, null, 2));
  console.log("Number of fields sent:", Object.keys(req.body).length);

  if (Object.keys(req.body).length < 3) {
    console.warn("⚠️ WARNING: AI sent too few fields! Probably dropping previous data!");
  }

  try {
    const { callId, phone } = req.body;
    const id = callId || phone || Date.now().toString();

    // CRITICAL FIX: Merge existing state with new data
    const existingState = callData[id] || {};
    const mergedState = { ...existingState, ...req.body };

    // Clean up: Remove non-state fields from the merge
    delete mergedState.phase;
    delete mergedState.instruction;
    delete mergedState.warnings;
    delete mergedState.collected;
    delete mergedState.full_chart;

    console.log(`Merged state for ${id}:`, mergedState);

    const result = computeNextAction(mergedState);

    // Store the complete merged state
    callData[id] = {
      ...mergedState,
      phase: result.phase,
      instruction: result.instruction,
      warnings: result.warnings,
      collected: result.collected
    };

    console.log(`Updated state for ${id}:`, JSON.stringify(callData[id], null, 2));

    res.json({
      next_action: result.phase,
      instruction: result.instruction,
      warnings: result.warnings,
      collected: result.collected,
      full_chart: callData[id]
    });
  } catch (err) {
    console.error("POST error:", err);
    res.status(500).json({ error: "Server error" });
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
        'Current time for slot validation',
        'Calendar parameters for 4-day range',
        'Full webhook payload with conversation data',
        'Bot loop prevention',
        `Stuck lead monitoring (${MONITORING_CONFIG.stuckThresholdMinutes}-minute threshold)`,
        'Email alerts for missed responses',
        'Auto-retry stuck leads to Lindy',
        '✅ FIXED: Timezone parsing for Google Ads timestamps'
      ],
      config: {
        pollIntervalMinutes: POLL_INTERVAL_MINUTES,
        pollBackMinutes: POLL_BACK_MINUTES,
        addPhoneLeads: ADD_PHONE_LEADS === 'true',
        hasGoogleCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
        hasLindyWebhook: !!LINDY_WEBHOOK_URL,
        customerId: GOOGLE_ADS_CUSTOMER_ID,
        calendarDaysAhead: 10,
        monitoring: {
          enabled: true,
          intervalMinutes: MONITORING_CONFIG.intervalMinutes,
          stuckThresholdMinutes: MONITORING_CONFIG.stuckThresholdMinutes,
          maxMessageAgeMinutes: MONITORING_CONFIG.maxMessageAgeMinutes,
          lookbackMinutes: MONITORING_CONFIG.lookbackMinutes
        },
        timezone: {
          server: Intl.DateTimeFormat().resolvedOptions().timeZone,
          client: process.env.TIME_ZONE
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
  cron.schedule(`*/${POLL_INTERVAL_MINUTES} * * * *`, async () => {
    console.log(`🕐 Automated ${POLL_INTERVAL_MINUTES}-minute polling triggered...`);
    try {
      await pollLeadsAndSendToLindy();
    } catch (error) {
      console.error('❌ Cron job failed:', error.message);
    }
  });
  console.log(`⏰ Polling cron scheduled: Every ${POLL_INTERVAL_MINUTES} minutes (looking back ${POLL_BACK_MINUTES} min)`);

  cron.schedule(`*/${MONITORING_CONFIG.intervalMinutes} * * * *`, async () => {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🔍 AUTOMATED MONITORING CHECK');
    console.log(`⏰ Time: ${new Date().toLocaleString('en-US', { timeZone: process.env.TIME_ZONE })}`);
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
          console.log(`   • Lead ${lead.leadId}: ${lead.minutesSinceLastMessage} min wait (ACTUAL)`);
        });
      }

      console.log('═══════════════════════════════════════════════════════\n');

    } catch (error) {
      console.error('❌ [MONITORING ERROR]:', error.message);
      console.log('═══════════════════════════════════════════════════════\n');
    }
  });

  console.log(`⏰ Monitoring cron scheduled: Every ${MONITORING_CONFIG.intervalMinutes} minutes\n`);
}

// ===== START SERVER =====

app.listen(PORT, () => {
  console.log(`\n🚀 LSA-to-Lindy Integration Server running on http://localhost:${PORT}`);
  console.log(`📊 Customer ID: ${GOOGLE_ADS_CUSTOMER_ID}`);
  console.log(`🔗 Lindy Webhook: ${LINDY_WEBHOOK_URL ? 'Configured ✅' : 'Not configured ❌'}`);
  console.log(`⚙️ Config: Poll every ${POLL_INTERVAL_MINUTES}min, fetch last ${POLL_BACK_MINUTES}min`);
  console.log(`🌍 Server Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log(`🌍 Client Timezone: ${process.env.TIME_ZONE}`);
  console.log(`\n🎯 Features:`);
  console.log(`   ✅ Current time for AI slot validation`);
  console.log(`   ✅ 4-day calendar range (weekend filtering)`);
  console.log(`   ✅ Full conversation history tracking`);
  console.log(`   ✅ Bot loop prevention`);
  console.log(`   ✅ Stuck lead monitoring (${MONITORING_CONFIG.stuckThresholdMinutes}-minute threshold)`);
  console.log(`   ✅ Email alerts for missed responses`);
  console.log(`   ✅ FIXED: Timezone parsing for Google Ads timestamps`);
  console.log(`\n📋 API Endpoints:`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   GET  http://localhost:${PORT}/api/poll-now`);
  console.log(`   GET  http://localhost:${PORT}/api/monitor-stuck`);
  console.log(`   GET  http://localhost:${PORT}/api/get-free-slots`);
});

module.exports = app;
