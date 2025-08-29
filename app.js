

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
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
  // DYNAMIC VARIABLES
  POLL_INTERVAL_MINUTES = 5,
  POLL_BACK_MINUTES = 250,
  ADD_PHONE_LEADS = 'false'
} = process.env;

// ===== TOKEN MANAGEMENT =====
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

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

// **ENHANCED: Fetch leads with full conversation history**
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
      
      // Mark leads with recent activity
      if (eventTime >= cutoffTime) {
        recentActivityLeads.add(leadId);
      }
    });
    
    console.log(`📊 Found conversations for ${Object.keys(conversationsByLead).length} leads, ${recentActivityLeads.size} with recent activity`);
    
    // Step 2: Get all leads with enhanced fields
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
    
    for (const result of allLeads) {
      const lead = result.localServicesLead;
      const createdTime = new Date(lead.creationDateTime);
      const leadConversations = conversationsByLead[lead.id] || [];
      
      // Find latest conversation time (last activity)
      const latestConversationTime = leadConversations.length > 0 
        ? new Date(Math.max(...leadConversations.map(c => new Date(c.eventDateTime))))
        : createdTime;
      
      const isNewLead = createdTime >= cutoffTime;
      const hasRecentActivity = recentActivityLeads.has(lead.id);
      
      // Include if newly created OR has recent activity
      if (isNewLead || hasRecentActivity) {
        // Apply phone lead filtering
        const includePhoneLeads = ADD_PHONE_LEADS === 'true';
        if (lead.leadType === 'PHONE_CALL' && !includePhoneLeads) {
          console.log(`⏭️ Skipping phone lead ${lead.id} (ADD_PHONE_LEADS=false)`);
          continue;
        }
        
        // Get the most recent consumer message
        const latestConsumerMessage = leadConversations
          .filter(c => c.participantType === 'CONSUMER')
          .sort((a, b) => new Date(b.eventDateTime) - new Date(a.eventDateTime));
        
        const messageText = latestConsumerMessage?.messageText || 
                           (lead.leadType === 'MESSAGE' ? 'Message content not available' : 
                            lead.leadType === 'PHONE_CALL' ? 'Phone call inquiry' :
                            `${lead.leadType} inquiry`);

        const contactDetails = lead.contactDetails || {};
        
        // **ENHANCED PAYLOAD WITH FULL HISTORY**
        const enrichedLead = {
          // Basic lead info
          leadId: lead.id,
          leadType: lead.leadType,
          leadStatus: lead.leadStatus,
          messageText: messageText,
          
          // **TIMING INFORMATION**
          timing: {
            creationDateTime: lead.creationDateTime,
            lastActivityDateTime: latestConversationTime.toISOString(),
            creditStateLastUpdateDateTime: lead.creditDetails?.creditStateLastUpdateDateTime || null,
            isNewLead: isNewLead,
            hasRecentActivity: hasRecentActivity
          },
          
          // **COMPLETE CONVERSATION HISTORY**
          conversationHistory: {
            totalConversations: leadConversations.length,
            conversations: leadConversations.sort((a, b) => new Date(a.eventDateTime) - new Date(b.eventDateTime))
          },
          
          // **LEAD DETAILS**
          leadDetails: {
            categoryId: lead.categoryId,
            serviceId: lead.serviceId,
            locale: lead.locale,
            leadCharged: lead.leadCharged,
            creditState: lead.creditDetails?.creditState || null
          },
          
          // **CONTACT INFORMATION**
          contactInfo: {
            name: contactDetails.consumerName || '',
            phone: contactDetails.phoneNumber || '',
            email: contactDetails.email || ''
          },
          
          // **GOHIGHLEVEL CONTACT FORMAT**
          ghlContactData: {
            locationId: process.env.GHL_LOCATION_ID || 'YOUR_LOCATION_ID',
            firstName: contactDetails.consumerName || 'LSA Lead',
            lastName: '',
            email: contactDetails.email || '',
            phone: contactDetails.phoneNumber || '',
            tags: ['lsa-lead', lead.leadType === 'MESSAGE' ? 'message-inquiry' : 'phone-inquiry'],
            source: 'Google LSA',
            customFields: [
              {
                id: 'LEAD_ID',
                field_value: lead.id
              },
              {
                id: 'MESSAGE',
                field_value: messageText
              },
              {
                id: 'LEAD_STATUS',
                field_value: lead.leadStatus
              },
              {
                id: 'CREATION_TIME',
                field_value: lead.creationDateTime
              },
              {
                id: 'LAST_ACTIVITY',
                field_value: latestConversationTime.toISOString()
              },
              {
                id: 'TOTAL_CONVERSATIONS',
                field_value: leadConversations.length.toString()
              }
            ]
          }
        };
        
        enrichedLeads.push(enrichedLead);
        
        if (hasRecentActivity && !isNewLead) {
          console.log(`🔄 Including lead ${lead.id} due to recent conversation activity (${leadConversations.length} total conversations)`);
        }
      }
    }
    
    console.log(`🎯 Processed ${enrichedLeads.length} leads with full conversation history`);
    
    return {
      success: true,
      leads: enrichedLeads,
      count: enrichedLeads.length,
      totalLeadsChecked: allLeads.length,
      recentActivityCount: recentActivityLeads.size,
      phoneLeadsExcluded: allLeads.length - enrichedLeads.length
    };
    
  } catch (error) {
    console.error('❌ Error fetching leads with conversation history:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      leads: [],
      count: 0
    };
  }
}

// **ENHANCED LOGGING**
function logDetailedPayloadForDebugging(lead) {
  console.log('\n🚀 DETAILED PAYLOAD BEING SENT TO LINDY:');
  console.log('='.repeat(50));
  console.log(`Lead ID: ${lead.leadId}`);
  console.log(`Lead Type: ${lead.leadType}`);
  console.log(`Lead Status: ${lead.leadStatus}`);
  console.log(`Message: "${lead.messageText}"`);
  console.log(`Created: ${lead.timing.creationDateTime}`);
  console.log(`Last Activity: ${lead.timing.lastActivityDateTime}`);
  console.log(`Total Conversations: ${lead.conversationHistory.totalConversations}`);
  console.log('Recent Conversations:');
  lead.conversationHistory.conversations.slice(-3).forEach((conv, index) => {
    console.log(`  ${index + 1}. ${conv.eventDateTime} (${conv.participantType}): ${conv.messageText || conv.channel}`);
  });
  console.log(`Contact: ${lead.contactInfo.name} <${lead.contactInfo.email}> ${lead.contactInfo.phone}`);
  console.log('='.repeat(50));
}

// **SEND TO LINDY WITH DETAILED PAYLOAD**
async function sendToLindy(payload) {
  if (!LINDY_WEBHOOK_URL) {
    console.warn('⚠️ Lindy webhook URL not configured');
    return { success: false, error: 'Webhook URL not configured' };
  }

  logDetailedPayloadForDebugging(payload);

  try {
    const response = await axios.post(LINDY_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LSA-GHL-Integration/2.0'
      },
      timeout: 15000
    });
    
    console.log(`✅ Sent detailed lead ${payload.leadId} to Lindy: ${response.status}`);
    return { 
      success: true, 
      leadId: payload.leadId,
      status: response.status,
      conversationCount: payload.conversationHistory.totalConversations
    };
    
  } catch (error) {
    console.error(`❌ Failed to send lead ${payload.leadId} to Lindy:`, error.message);
    return { 
      success: false, 
      leadId: payload.leadId,
      error: error.message
    };
  }
}

// **MAIN POLLING FUNCTION WITH DETAILED RESPONSE**
async function pollLeadsAndSendToLindy() {
  console.log(`\n🔄 Starting enhanced LSA polling for last ${POLL_BACK_MINUTES} minutes...`);
  
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
      message: `No leads found in last ${POLL_BACK_MINUTES} minutes`,
      summary: {
        totalLeadsChecked: leadsResult.totalLeadsChecked,
        recentActivityCount: leadsResult.recentActivityCount
      }
    };
  }
  
  console.log(`📬 Processing ${leadsResult.count} enriched leads...`);
  
  // Send to Lindy
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
    failed: leadsResult.count - sentCount,
    summary: {
      totalLeadsChecked: leadsResult.totalLeadsChecked,
      recentActivityCount: leadsResult.recentActivityCount,
      phoneLeadsExcluded: leadsResult.phoneLeadsExcluded
    },
    leadsData: leadsResult.leads, // **INCLUDE FULL DATA FOR POSTMAN RESPONSE**
    lindyResults: lindyResults,
    timestamp: new Date().toISOString()
  };
}

// ===== API ENDPOINTS =====

// **ENHANCED: Manual trigger with detailed response**
app.get('/api/poll-now', async (req, res) => {
  try {
    const result = await pollLeadsAndSendToLindy();
    
    // **DETAILED POSTMAN RESPONSE**
    res.json({
      success: result.success,
      message: result.error || 'Enhanced polling completed with conversation history',
      timestamp: new Date().toISOString(),
      statistics: {
        processed: result.processed,
        sentToLindy: result.sent,
        failed: result.failed,
        totalLeadsChecked: result.summary?.totalLeadsChecked,
        recentActivityCount: result.summary?.recentActivityCount,
        phoneLeadsExcluded: result.summary?.phoneLeadsExcluded
      },
      // **FULL DATA SENT TO LINDY (for Postman visibility)**
      leadsDataSentToLindy: result.leadsData || [],
      lindyWebhookResults: result.lindyResults || [],
      config: {
        pollBackMinutes: POLL_BACK_MINUTES,
        addPhoneLeads: ADD_PHONE_LEADS === 'true',
        webhookConfigured: !!LINDY_WEBHOOK_URL
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

// **ENHANCED: Get leads with full conversation history**
app.get('/api/leads/last/:minutes', async (req, res) => {
  const minutes = parseInt(req.params.minutes) || 5;
  
  if (minutes < 1 || minutes > 43200) {
    return res.status(400).json({
      success: false,
      error: 'Minutes must be between 1 and 43200 (30 days)'
    });
  }
  
  try {
    const leadsResult = await fetchLSALeadsWithConversationHistory(minutes);
    
    if (!leadsResult.success) {
      return res.status(500).json(leadsResult);
    }
    
    res.json({
      success: true,
      leadsWithFullHistory: leadsResult.leads,
      count: leadsResult.count,
      statistics: {
        totalLeadsChecked: leadsResult.totalLeadsChecked,
        recentActivityCount: leadsResult.recentActivityCount,
        phoneLeadsExcluded: leadsResult.phoneLeadsExcluded
      },
      config: {
        minutesBack: minutes,
        addPhoneLeads: ADD_PHONE_LEADS === 'true',
        pollBackMinutes: POLL_BACK_MINUTES,
        pollInterval: POLL_INTERVAL_MINUTES
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const accessToken = await getGoogleAccessToken();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      features: [
        'Enhanced conversation history tracking',
        'Detailed timing information',
        'Full webhook payload with conversation data',
        'Postman-friendly detailed responses'
      ],
      config: {
        pollIntervalMinutes: POLL_INTERVAL_MINUTES,
        pollBackMinutes: POLL_BACK_MINUTES,
        addPhoneLeads: ADD_PHONE_LEADS === 'true',
        hasGoogleCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
        hasLindyWebhook: !!LINDY_WEBHOOK_URL,
        customerId: GOOGLE_ADS_CUSTOMER_ID
      },
      tokenSystem: {
        status: 'working',
        hasValidToken: !!accessToken,
        tokenExpiresAt: new Date(tokenCache.expiresAt).toISOString(),
        autoRefreshEnabled: true
      }
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// **CRON JOB**
if (process.env.NODE_ENV !== 'test') {
  cron.schedule(`*/${POLL_INTERVAL_MINUTES} * * * *`, async () => {
    console.log(`🕐 Automated ${POLL_INTERVAL_MINUTES}-minute enhanced polling triggered...`);
    try {
      await pollLeadsAndSendToLindy();
    } catch (error) {
      console.error('❌ Cron job failed:', error.message);
    }
  });
  
  console.log(`⏰ Enhanced cron job scheduled: Every ${POLL_INTERVAL_MINUTES} minutes`);
}

app.listen(PORT, () => {
  console.log(`🚀 Enhanced LSA-to-GHL Integration Server running on http://localhost:${PORT}`);
  console.log(`📊 Customer ID: ${GOOGLE_ADS_CUSTOMER_ID}`);
  console.log(`🔗 Lindy Webhook: ${LINDY_WEBHOOK_URL ? 'Configured ✅' : 'Not configured ❌'}`);
  console.log(`⚙️ Config: Poll every ${POLL_INTERVAL_MINUTES}min, fetch last ${POLL_BACK_MINUTES}min, phone leads: ${ADD_PHONE_LEADS}`);
  console.log(`\n🎯 Enhanced Features:`);
  console.log(`   ✅ Full conversation history tracking`);
  console.log(`   ✅ Detailed timing information (creation + last activity)`);
  console.log(`   ✅ Enhanced webhook payload with conversation data`);
  console.log(`   ✅ Postman-friendly detailed API responses`);
  console.log(`\n📋 API Endpoints:`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   GET  http://localhost:${PORT}/api/poll-now`);
  console.log(`   GET  http://localhost:${PORT}/api/leads/last/60`);
});

module.exports = app;
