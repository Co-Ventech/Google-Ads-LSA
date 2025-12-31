/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  MONITORING SERVICE - Self-contained with timezone-aware fetching             ║
 * ║  Version: 2.0.0                                                               ║
 * ║  This module has its own fetching logic - does NOT touch existing polling     ║
 * ║  Supports any timezone: America/New_York, America/Los_Angeles, America/Denver ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

const axios = require('axios');
const qs = require('querystring');

// ===== MONITORING CONFIGURATION =====
const MONITORING_CONFIG = {
  intervalMinutes: parseInt(process.env.MONITOR_INTERVAL_MINUTES) || 10,
  stuckThresholdMinutes: parseInt(process.env.MONITOR_STUCK_THRESHOLD_MINUTES) || 15,
  maxMessageAgeMinutes: parseInt(process.env.MONITOR_MAX_MESSAGE_AGE_MINUTES) || 60,
  lookbackMinutes: parseInt(process.env.MONITOR_LOOKBACK_MINUTES) || 250
};

// ===== TOKEN CACHE (separate from main app to avoid conflicts) =====
let monitorTokenCache = {
  accessToken: null,
  expiresAt: 0
};

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  TIMEZONE-AWARE TIMESTAMP PARSER                                              ║
 * ║  Google Ads returns timestamps like "2025-12-31 09:11:55" in ACCOUNT timezone ║
 * ║  This function correctly converts to UTC milliseconds                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
function parseGoogleAdsTimestamp(googleTimestamp, accountTimezone) {
  if (!googleTimestamp) return null;
  
  const tz = accountTimezone || process.env.TIME_ZONE || 'America/New_York';
  
  // Handle ISO format (already has timezone info like "Z" or "+00:00")
  if (googleTimestamp.includes('T') && (googleTimestamp.includes('Z') || googleTimestamp.includes('+') || googleTimestamp.match(/-\d{2}:\d{2}$/))) {
    return new Date(googleTimestamp).getTime();
  }
  
  // For Google Ads format "YYYY-MM-DD HH:MM:SS.microseconds" (no timezone indicator)
  // This timestamp is in the ACCOUNT's timezone
  
  // Clean up microseconds if present
  const cleanTimestamp = googleTimestamp.split('.')[0];
  
  // Get current time in both UTC and account timezone to calculate offset
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
  
  const utcString = now.toISOString().slice(0, 19).replace('T', ' ');
  
  const tzParts = formatter.formatToParts(now);
  const tzObj = {};
  tzParts.forEach(p => { if (p.type !== 'literal') tzObj[p.type] = p.value; });
  const tzString = `${tzObj.year}-${tzObj.month}-${tzObj.day} ${tzObj.hour}:${tzObj.minute}:${tzObj.second}`;
  
  // Calculate offset: how many ms ahead/behind is the timezone from UTC
  const utcMs = new Date(utcString.replace(' ', 'T') + 'Z').getTime();
  const tzMs = new Date(tzString.replace(' ', 'T') + 'Z').getTime();
  const offsetMs = tzMs - utcMs;
  
  // Parse the Google timestamp as if it were UTC
  const googleMs = new Date(cleanTimestamp.replace(' ', 'T') + 'Z').getTime();
  
  // Convert to actual UTC by subtracting the offset
  const actualUtcMs = googleMs - offsetMs;
  
  return actualUtcMs;
}

/**
 * Calculate ACTUAL minutes since a Google Ads timestamp
 */
function getActualMinutesSinceGoogleTimestamp(googleTimestamp, accountTimezone) {
  const actualUtcMs = parseGoogleAdsTimestamp(googleTimestamp, accountTimezone);
  if (!actualUtcMs) return 0;
  
  const now = Date.now();
  const diffMs = now - actualUtcMs;
  const diffMinutes = Math.floor(diffMs / 60000);
  
  return Math.max(0, diffMinutes);
}

/**
 * Get Google Access Token (separate cache for monitoring)
 */
async function getMonitoringAccessToken() {
  const now = Date.now();
  
  if (monitorTokenCache.accessToken && now < monitorTokenCache.expiresAt - 60000) {
    return monitorTokenCache.accessToken;
  }

  console.log('🔄 [MONITOR] Generating access token...');
  
  try {
    const response = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    monitorTokenCache.accessToken = response.data.access_token;
    monitorTokenCache.expiresAt = now + (response.data.expires_in * 1000);
    
    return monitorTokenCache.accessToken;
    
  } catch (error) {
    console.error('❌ [MONITOR] Token generation failed:', error.message);
    throw error;
  }
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  MONITORING-SPECIFIC FETCH FUNCTION                                           ║
 * ║  This is SEPARATE from the main polling fetch - won't affect production       ║
 * ║  Uses timezone-aware parsing throughout                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
async function fetchLeadsForMonitoring(lookbackMinutes) {
  const accountTimezone = process.env.TIME_ZONE || 'America/New_York';
  const now = Date.now();
  const cutoffTime = new Date(now - lookbackMinutes * 60 * 1000);
  
  console.log(`🔍 [MONITOR] Fetching leads for monitoring (last ${lookbackMinutes} minutes)`);
  console.log(`   Account timezone: ${accountTimezone}`);
  console.log(`   Cutoff time (UTC): ${cutoffTime.toISOString()}`);
  
  const accessToken = await getMonitoringAccessToken();
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json'
  };
  
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  }

  const url = `https://googleads.googleapis.com/v21/customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
  try {
    // Fetch conversations
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
    
    // ╔═══════════════════════════════════════════════════════════════════════════╗
    // ║  KEY FIX: Use timezone-aware parsing for filtering                        ║
    // ╚═══════════════════════════════════════════════════════════════════════════╝
    allConversations.forEach(conv => {
      const conversation = conv.localServicesLeadConversation;
      const leadResourceName = conversation.lead;
      const leadId = leadResourceName.split('/').pop();
      
      // ✅ CORRECT: Parse with timezone awareness
      const eventTimeMs = parseGoogleAdsTimestamp(conversation.eventDateTime, accountTimezone);
      const eventTime = new Date(eventTimeMs);
      
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
      
      // ✅ CORRECT: Compare properly parsed time against cutoff
      if (eventTime >= cutoffTime) {
        recentActivityLeads.add(leadId);
      }
    });
    
    console.log(`📊 [MONITOR] Found ${Object.keys(conversationsByLead).length} leads with conversations`);
    console.log(`📊 [MONITOR] ${recentActivityLeads.size} leads with recent activity (within ${lookbackMinutes} min)`);
    
    // Fetch lead details
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
    
    // Build enriched leads for monitoring (only those with recent activity)
    const enrichedLeads = [];
    
    for (const result of allLeads) {
      const lead = result.localServicesLead;
      const leadConversations = conversationsByLead[lead.id] || [];
      
      // Only include leads with recent activity
      if (recentActivityLeads.has(lead.id)) {
        // Skip phone leads if configured
        const includePhoneLeads = process.env.ADD_PHONE_LEADS === 'true';
        if (lead.leadType === 'PHONE_CALL' && !includePhoneLeads) {
          console.log(`⏭️ [MONITOR] Skipping phone lead ${lead.id}`);
          continue;
        }
        
        const contactDetails = lead.contactDetails || {};
        
        // Get latest consumer message
        const latestConsumerMessage = leadConversations
          .filter(c => c.participantType === 'CONSUMER')
          .sort((a, b) => {
            const aTime = parseGoogleAdsTimestamp(b.eventDateTime, accountTimezone);
            const bTime = parseGoogleAdsTimestamp(a.eventDateTime, accountTimezone);
            return aTime - bTime;
          })[0];
        
        const messageText = latestConsumerMessage?.messageText || 
                           (lead.leadType === 'MESSAGE' ? 'Message content not available' : 
                            lead.leadType === 'PHONE_CALL' ? 'Phone call inquiry' :
                            `${lead.leadType} inquiry`);
        
        enrichedLeads.push({
          leadId: lead.id,
          leadType: lead.leadType,
          leadStatus: lead.leadStatus,
          messageText: messageText,
          
          timing: {
            creationDateTime: lead.creationDateTime,
            lastActivityDateTime: leadConversations.length > 0 
              ? leadConversations.sort((a, b) => {
                  const aTime = parseGoogleAdsTimestamp(b.eventDateTime, accountTimezone);
                  const bTime = parseGoogleAdsTimestamp(a.eventDateTime, accountTimezone);
                  return aTime - bTime;
                })[0].eventDateTime
              : lead.creationDateTime
          },
          
          conversationHistory: {
            totalConversations: leadConversations.length,
            conversations: leadConversations.sort((a, b) => {
              const aTime = parseGoogleAdsTimestamp(a.eventDateTime, accountTimezone);
              const bTime = parseGoogleAdsTimestamp(b.eventDateTime, accountTimezone);
              return aTime - bTime;
            })
          },
          
          contactInfo: {
            name: contactDetails.consumerName || '',
            phone: contactDetails.phoneNumber || '',
            email: contactDetails.email || ''
          }
        });
      }
    }
    
    console.log(`🎯 [MONITOR] Processed ${enrichedLeads.length} leads for monitoring check`);
    
    return {
      success: true,
      leads: enrichedLeads,
      count: enrichedLeads.length
    };
    
  } catch (error) {
    console.error('❌ [MONITOR] Error fetching leads:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      leads: [],
      count: 0
    };
  }
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  MAIN MONITORING FUNCTION                                                     ║
 * ║  Replace the existing monitorStuckConversations() with this                   ║
 * ║  Uses its own fetchLeadsForMonitoring() - doesn't touch production polling    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
async function monitorStuckConversations() {
  const accountTimezone = process.env.TIME_ZONE || 'America/New_York';
  
  console.log('\n🔍 ════════════════════════════════════════════════════════════');
  console.log('🔍 MONITORING SERVICE v2.0 - Timezone-Aware');
  console.log('🔍 ════════════════════════════════════════════════════════════');
  console.log(`   Customer: ${process.env.CUSTOMER_NAME || 'Unknown'}`);
  console.log(`   Account Timezone: ${accountTimezone}`);
  console.log(`   Server Time (UTC): ${new Date().toISOString()}`);
  console.log(`   Local Time (${accountTimezone}): ${new Date().toLocaleString('en-US', { timeZone: accountTimezone })}`);
  console.log(`   Stuck Threshold: ${MONITORING_CONFIG.stuckThresholdMinutes} minutes`);
  console.log(`   Max Message Age: ${MONITORING_CONFIG.maxMessageAgeMinutes} minutes`);
  console.log(`   Lookback: ${MONITORING_CONFIG.lookbackMinutes} minutes`);
  console.log('🔍 ════════════════════════════════════════════════════════════\n');
  
  const { sendStuckLeadAlert } = require('./emailService');
  
  // Use our own timezone-aware fetch function
  const leadsResult = await fetchLeadsForMonitoring(MONITORING_CONFIG.lookbackMinutes);
  
  if (!leadsResult.success || leadsResult.count === 0) {
    console.log('📭 [MONITOR] No leads to monitor');
    return { success: true, stuckLeads: [], checked: 0, emailSent: false };
  }
  
  const stuckLeads = [];
  
  console.log(`\n🔍 [MONITOR] Checking ${leadsResult.count} leads for stuck conversations...\n`);
  
  for (const lead of leadsResult.leads) {
    const conversations = lead.conversationHistory.conversations;
    
    if (conversations.length === 0) {
      console.log(`⏭️ Lead ${lead.leadId}: No conversations`);
      continue;
    }
    
    const lastMessage = conversations[conversations.length - 1];
    
    if (!lastMessage) {
      console.log(`⏭️ Lead ${lead.leadId}: No messages found`);
      continue;
    }
    
    // Calculate ACTUAL minutes with timezone awareness
    const minutesSinceLastMessage = getActualMinutesSinceGoogleTimestamp(
      lastMessage.eventDateTime, 
      accountTimezone
    );
    
    console.log(`📋 Lead ${lead.leadId}: ${conversations.length} messages total`);
    console.log(`   Last message from: ${lastMessage.participantType}`);
    console.log(`   Google timestamp (${accountTimezone}): ${lastMessage.eventDateTime}`);
    console.log(`   ⏱️ ACTUAL minutes since message: ${minutesSinceLastMessage} min`);
    console.log(`   Threshold: ${MONITORING_CONFIG.stuckThresholdMinutes} min`);
    
    // CHECK 1: Is the last message from CONSUMER?
    if (lastMessage.participantType !== 'CONSUMER') {
      console.log(`   ✅ SKIP: Last message is from ${lastMessage.participantType} - AI responded\n`);
      continue;
    }
    
    console.log(`   ✓ Check 1 passed: Last message IS from CONSUMER`);
    
    // CHECK 2: Have threshold minutes passed?
    if (minutesSinceLastMessage < MONITORING_CONFIG.stuckThresholdMinutes) {
      console.log(`   ✅ SKIP: Only ${minutesSinceLastMessage} min passed (need ${MONITORING_CONFIG.stuckThresholdMinutes} min)\n`);
      continue;
    }
    
    console.log(`   ✓ Check 2 passed: ${minutesSinceLastMessage} >= ${MONITORING_CONFIG.stuckThresholdMinutes}`);
    
    // CHECK 3: Skip very old messages
    if (minutesSinceLastMessage > MONITORING_CONFIG.maxMessageAgeMinutes) {
      console.log(`   ⏭️ SKIP: Message too old (${minutesSinceLastMessage} min > ${MONITORING_CONFIG.maxMessageAgeMinutes} max)\n`);
      continue;
    }
    
    console.log(`   ✓ Check 3 passed: ${minutesSinceLastMessage} <= ${MONITORING_CONFIG.maxMessageAgeMinutes}`);
    
    // All checks passed: This is a genuinely stuck lead
    console.log(`\n🚨 STUCK LEAD DETECTED: ${lead.leadId}`);
    console.log(`   ├─ Customer: ${lead.contactInfo.name || 'Unknown'}`);
    console.log(`   ├─ Phone: ${lead.contactInfo.phone || 'N/A'}`);
    console.log(`   ├─ Waiting: ${minutesSinceLastMessage} minutes (ACTUAL)`);
    console.log(`   ├─ Last Message: "${lastMessage.messageText.substring(0, 60)}..."`);
    console.log(`   └─ Last Message Time: ${lastMessage.eventDateTime} (${accountTimezone})\n`);
    
    stuckLeads.push({
      ...lead,
      minutesSinceLastMessage: minutesSinceLastMessage,
      lastMessageFrom: 'CONSUMER',
      lastMessageText: lastMessage.messageText,
      lastMessageTime: lastMessage.eventDateTime,
      lastMessageTimeLocal: new Date(parseGoogleAdsTimestamp(lastMessage.eventDateTime, accountTimezone))
        .toLocaleString('en-US', { timeZone: accountTimezone }),
      hasAIResponse: false
    });
  }
  
  console.log(`\n📊 [MONITOR] Results:`);
  console.log(`   Total leads checked: ${leadsResult.count}`);
  console.log(`   Stuck leads found: ${stuckLeads.length}`);
  
  if (stuckLeads.length > 0) {
    console.log(`\n📧 [MONITOR] Sending email alert for ${stuckLeads.length} stuck lead(s)...`);
    
    const emailResult = await sendStuckLeadAlert(stuckLeads);
    
    if (emailResult.statusCode === 200) {
      console.log(`✅ [MONITOR] Email alert sent successfully to: ${process.env.NOTIFICATION_EMAIL}`);
      console.log(`   Message ID: ${emailResult.messageId}`);
    } else {
      console.log(`❌ [MONITOR] Email alert failed: ${emailResult.message}`);
    }
    
    return {
      success: true,
      stuckLeads: stuckLeads,
      checked: leadsResult.count,
      emailSent: emailResult.statusCode === 200
    };
    
  } else {
    console.log(`✅ [MONITOR] All conversations are healthy - no alerts needed`);
    
    return {
      success: true,
      stuckLeads: [],
      checked: leadsResult.count,
      emailSent: false,
      message: 'All conversations healthy ✅'
    };
  }
}

// Export for use in app.js
module.exports = {
  monitorStuckConversations,
  fetchLeadsForMonitoring,
  parseGoogleAdsTimestamp,
  getActualMinutesSinceGoogleTimestamp,
  MONITORING_CONFIG
};