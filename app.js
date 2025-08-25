// require('dotenv').config();
// const express = require('express');
// const axios = require('axios');
// const path = require('path');
// const fs = require('fs').promises;
// const cron = require('node-cron');

// const app = express();
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// // app.use(express.static(path.join(__dirname, 'public')));
// // app.set('view engine', 'ejs');
// // app.set('views', path.join(__dirname, 'views'));

// const PORT = process.env.PORT || 3000;
// const {
//   GOOGLE_ADS_TOKEN,
//   GOOGLE_ADS_DEVELOPER_TOKEN,
//   GOOGLE_ADS_CUSTOMER_ID,
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID,
//   LINDY_WEBHOOK_URL,
// } = process.env;

// // Enhanced error handling function
// function logGoogleAdsError(error, context = '') {
//   console.error(`\n❌ Google Ads API Error ${context}:`);
  
//   if (error.response && error.response.data) {
//     const errorData = error.response.data;
//     console.error('Status Code:', error.response.status);
//     console.error('Error Object:', JSON.stringify(errorData, null, 2));
//     return errorData.error?.message || 'Unknown Google Ads API Error';
//   } else {
//     console.error('Network/Other Error:', error.message);
//     return error.message;
//   }
// }

// // **CORRECT: Fetch all recent leads and filter client-side**
// async function fetchLSALeadsLastMinutes(minutes = 5) {
//   const now = new Date();
//   const cutoffTime = new Date(now.getTime() - minutes * 60 * 1000);
  
//   // **OFFICIAL GOOGLE ADS API QUERY from documentation**
//   const query = `SELECT local_services_lead.lead_type, local_services_lead.category_id, local_services_lead.service_id, local_services_lead.contact_details, local_services_lead.lead_status, local_services_lead.creation_date_time, local_services_lead.locale, local_services_lead.lead_charged, local_services_lead.id, local_services_lead.resource_name FROM local_services_lead ORDER BY local_services_lead.creation_date_time DESC LIMIT 500`;

//   const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
//   const headers = {
//     'Authorization': `Bearer ${GOOGLE_ADS_TOKEN}`,
//     'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
//     'Content-Type': 'application/json'
//   };
  
//   if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
//     headers['login-customer-id'] = GOOGLE_ADS_LOGIN_CUSTOMER_ID;
//   }

//   console.log(`🔍 Fetching LSA leads and filtering for last ${minutes} minutes`);
//   console.log(`⏰ Time cutoff: ${cutoffTime.toISOString()}`);
//   console.log('🔧 Official GAQL Query:', query);

//   try {
//     const response = await axios.post(url, { query }, { headers });
//     const allResults = response.data.results || [];
    
//     console.log(`📊 Found ${allResults.length} total leads`);
    
//     // **CLIENT-SIDE TIME FILTERING (only way to get minute precision)**
//     const recentResults = allResults.filter(result => {
//       const lead = result.localServicesLead;
      
//       // Parse the creation_date_time from Google Ads API format
//       const leadTime = new Date(lead.creationDateTime);
//       const isRecent = leadTime >= cutoffTime;
      
//       if (isRecent) {
//         console.log(`✅ Lead ${lead.id} is recent: ${lead.creationDateTime}`);
//       }
      
//       return isRecent;
//     });
    
//     console.log(`🎯 Filtered to ${recentResults.length} leads from last ${minutes} minutes`);
    
//     return {
//       success: true,
//       leads: recentResults,
//       count: recentResults.length,
//       totalCount: allResults.length,
//       timeWindow: {
//         minutes,
//         cutoffTime: cutoffTime.toISOString(),
//         currentTime: now.toISOString()
//       }
//     };
    
//   } catch (error) {
//     const errorMessage = logGoogleAdsError(error, `while fetching leads for last ${minutes} minutes`);
    
//     return {
//       success: false,
//       error: errorMessage,
//       leads: [],
//       count: 0,
//       timeWindow: {
//         minutes,
//         cutoffTime: cutoffTime.toISOString(),
//         currentTime: now.toISOString()
//       }
//     };
//   }
// }

// // Fetch conversations for a specific lead
// async function fetchLeadConversations(leadResourceName) {
//   const query = `SELECT local_services_lead_conversation.id, local_services_lead_conversation.conversation_channel, local_services_lead_conversation.participant_type, local_services_lead_conversation.lead, local_services_lead_conversation.event_date_time, local_services_lead_conversation.phone_call_details.call_duration_millis, local_services_lead_conversation.phone_call_details.call_recording_url, local_services_lead_conversation.message_details.text, local_services_lead_conversation.message_details.attachment_urls FROM local_services_lead_conversation WHERE local_services_lead_conversation.lead = '${leadResourceName}'`;

//   const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
//   const headers = {
//     'Authorization': `Bearer ${GOOGLE_ADS_TOKEN}`,
//     'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
//     'Content-Type': 'application/json'
//   };
  
//   if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
//     headers['login-customer-id'] = GOOGLE_ADS_LOGIN_CUSTOMER_ID;
//   }

//   try {
//     const response = await axios.post(url, { query }, { headers });
//     return response.data.results || [];
//   } catch (error) {
//     logGoogleAdsError(error, `while fetching conversations for lead ${leadResourceName}`);
//     return [];
//   }
// }

// // **Transform only essential Milestone 2 fields**
// const transformLeadForLindy = (leadData, conversations = []) => {
//   const lead = leadData.localServicesLead;
  
//   // Get actual message text from conversation
//   const latestConversation = conversations.find(c => 
//     c.localServicesLeadConversation?.participantType === 'CONSUMER'
//   );
//   const actualMessageText = latestConversation?.localServicesLeadConversation?.messageDetails?.text;
  
//   const messageText = actualMessageText || 
//                       (lead.leadType === 'MESSAGE' ? 'Message content not available' : 
//                        lead.leadType === 'PHONE_CALL' ? 'Phone call inquiry' :
//                        `${lead.leadType} inquiry`);

//   const contactDetails = lead.contactDetails || {};

//   return {
//     // **MILESTONE 2 REQUIRED FIELDS ONLY**
//     leadId: lead.id,
//     messageText: messageText,
//     sender: latestConversation?.localServicesLeadConversation?.participantType || 'CONSUMER',
//     timestamp: lead.creationDateTime,
//     contactInfo: {
//       name: contactDetails.consumerName || '',
//       phone: contactDetails.phoneNumber || '',
//       email: contactDetails.email || ''
//     }
//   };
// };

// // Send to Lindy webhook
// async function sendToLindy(payload) {
//   if (!LINDY_WEBHOOK_URL) {
//     console.warn('⚠️ Lindy webhook URL not configured');
//     return { success: false, error: 'Webhook URL not configured' };
//   }

//   try {
//     const response = await axios.post(LINDY_WEBHOOK_URL, payload, {
//       headers: {
//         'Content-Type': 'application/json',
//         'User-Agent': 'LSA-Poller/3.0'
//       },
//       timeout: 10000
//     });
    
//     console.log(`✅ Sent leadId ${payload.leadId} to Lindy: ${response.status}`);
//     return { 
//       success: true, 
//       leadId: payload.leadId,
//       status: response.status
//     };
    
//   } catch (error) {
//     console.error(`❌ Failed to send leadId ${payload.leadId} to Lindy:`, error.message);
//     return { 
//       success: false, 
//       leadId: payload.leadId,
//       error: error.response?.status === 404 ? 'Webhook URL not found (404)' : error.message
//     };
//   }
// }

// // **Poll leads for last N minutes**
// async function pollLeadsLastMinutes(minutes = 5) {
//   console.log(`\n🔄 Starting LSA polling for last ${minutes} minutes...`);
  
//   // Fetch leads with proper Google Ads API query
//   const leadsResult = await fetchLSALeadsLastMinutes(minutes);
  
//   if (!leadsResult.success) {
//     return {
//       success: false,
//       error: leadsResult.error,
//       leads: [],
//       processedCount: 0,
//       sentCount: 0,
//       timeWindow: leadsResult.timeWindow
//     };
//   }
  
//   if (leadsResult.count === 0) {
//     console.log(`📭 No leads found in last ${minutes} minutes`);
//     return {
//       success: true,
//       leads: [],
//       processedCount: 0,
//       sentCount: 0,
//       message: `No leads found in last ${minutes} minutes (${leadsResult.totalCount} total leads)`,
//       timeWindow: leadsResult.timeWindow
//     };
//   }
  
//   // Process each lead
//   const processedLeads = [];
  
//   for (const leadData of leadsResult.leads) {
//     const lead = leadData.localServicesLead;
//     console.log(`🔍 Processing lead ${lead.id} (${lead.leadType}) - ${lead.creationDateTime}`);
    
//     // Fetch conversations for MESSAGE type leads
//     let conversations = [];
//     if (lead.leadType === 'MESSAGE') {
//       conversations = await fetchLeadConversations(lead.resourceName);
//       console.log(`💬 Found ${conversations.length} conversations for lead ${lead.id}`);
//     }
    
//     // Transform for Lindy (only essential fields)
//     const transformedLead = transformLeadForLindy(leadData, conversations);
//     processedLeads.push(transformedLead);
//   }
  
//   // Send to Lindy
//   const lindyResults = [];
//   for (const lead of processedLeads) {
//     const result = await sendToLindy(lead);
//     lindyResults.push(result);
//   }
  
//   const sentCount = lindyResults.filter(r => r.success).length;
//   console.log(`✅ Processing complete: ${sentCount}/${processedLeads.length} sent to Lindy\n`);
  
//   return {
//     success: true,
//     leads: processedLeads,
//     lindyResults,
//     processedCount: processedLeads.length,
//     sentCount,
//     timeWindow: leadsResult.timeWindow,
//     totalCount: leadsResult.totalCount,
//     timestamp: new Date().toISOString()
//   };
// }

// // ===== API ENDPOINTS =====

// // Poll last 5 minutes (for cron)
// app.get('/api/poll/recent', async (req, res) => {
//   const result = await pollLeadsLastMinutes(5);
//   res.json(result);
// });

// // Get leads from last N minutes
// app.get('/api/leads/last/:minutes', async (req, res) => {
//   const minutes = parseInt(req.params.minutes) || 5;
  
//   if (minutes < 1 || minutes > 1440) {
//     return res.status(400).json({
//       success: false,
//       error: 'Minutes must be between 1 and 1440 (24 hours)'
//     });
//   }
  
//   const result = await pollLeadsLastMinutes(minutes);
//   res.json(result);
// });

// // Health check
// app.get('/api/health', (req, res) => {
//   res.json({
//     status: 'healthy',
//     timestamp: new Date().toISOString(),
//     config: {
//       hasGoogleAdsToken: !!GOOGLE_ADS_TOKEN,
//       hasLindyWebhook: !!LINDY_WEBHOOK_URL,
//       customerId: GOOGLE_ADS_CUSTOMER_ID,
//       port: PORT
//     },
//     note: 'Using official Google Ads API queries from documentation'
//   });
// });

// // API documentation
// app.get('/api', (req, res) => {
//   res.json({
//     message: 'LSA Message Retrieval API - Official Google Ads API Implementation',
//     version: '3.0.0',
//     endpoints: {
//       'GET /api/poll/recent': 'Poll leads from last 5 minutes (for cron job)',
//       'GET /api/leads/last/:minutes': 'Get leads from last N minutes (1-1440)',
//       'GET /api/health': 'Check system health'
//     },
//     examples: {
//       'Poll recent for cron': `GET ${req.protocol}://${req.get('host')}/api/poll/recent`,
//       'Get last 30 minutes': `GET ${req.protocol}://${req.get('host')}/api/leads/last/30`
//     },
//     notes: [
//       'Uses official Google Ads API queries from documentation',
//       'No date filtering in GAQL - client-side time filtering only',
//       'Fetches recent leads and filters by creation_date_time'
//     ]
//   });
// });

// // **CRON JOB: Auto-poll every 5 minutes**
// if (process.env.NODE_ENV !== 'test') {
//   cron.schedule('*/5 * * * *', async () => {
//     console.log('🕐 Automated 5-minute polling triggered...');
//     const result = await pollLeadsLastMinutes(5);
//     console.log(`⏰ Cron result: ${result.processedCount} processed, ${result.sentCount} sent`);
//   });
  
//   console.log('⏰ Cron job scheduled: Every 5 minutes');
// }

// app.listen(PORT, () => {
//   console.log(`🚀 LSA Message Retrieval Server running on http://localhost:${PORT}`);
//   console.log(`📊 Customer ID: ${GOOGLE_ADS_CUSTOMER_ID}`);
//   console.log(`🔗 Lindy Webhook: ${LINDY_WEBHOOK_URL ? 'Configured ✅' : 'Not configured ❌'}`);
//   console.log(`\n📋 Official Google Ads API Endpoints:`);
//   console.log(`   GET  http://localhost:${PORT}/api/poll/recent`);
//   console.log(`   GET  http://localhost:${PORT}/api/leads/last/30`);
//   console.log(`\n✅ Using OFFICIAL Google Ads API queries from documentation`);
// });

// module.exports = app;
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

// ===== UPDATED ENVIRONMENT VARIABLES =====
const {
  GOOGLE_CLIENT_ID,          // Add these to your .env
  GOOGLE_CLIENT_SECRET,      // Add these to your .env  
  GOOGLE_REFRESH_TOKEN,      // Add these to your .env
  GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_ADS_CUSTOMER_ID,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  LINDY_WEBHOOK_URL,
  GHL_ACCESS_TOKEN,
  GHL_LOCATION_ID,
  PROBATE_CALENDAR_ID,
  ESTATE_PLANNING_CALENDAR_ID
} = process.env;

// ===== TOKEN MANAGEMENT SYSTEM =====
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

/**
 * Auto-generates Google Access Token using Client ID/Secret
 * Automatically refreshes when token expires
 */
async function getGoogleAccessToken() {
  const now = Date.now();
  
  // Return cached token if still valid (with 60-second buffer)
  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60000) {
    console.log('✅ Using cached access token');
    return tokenCache.accessToken;
  }

  console.log('🔄 Auto-generating new Google access token...');
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing required Google OAuth credentials in environment variables');
  }

  try {
    // Use Google OAuth2 endpoint to refresh token
    const response = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    // Cache the new token
    tokenCache.accessToken = response.data.access_token;
    tokenCache.expiresAt = now + (response.data.expires_in * 1000);
    
    console.log(`✅ New access token generated successfully`);
    console.log(`⏰ Token expires in ${response.data.expires_in} seconds`);
    console.log(`🕒 Token expires at: ${new Date(tokenCache.expiresAt).toISOString()}`);
    
    return tokenCache.accessToken;
    
  } catch (error) {
    console.error('❌ Failed to generate access token:', error.response?.data || error.message);
    throw new Error(`Token generation failed: ${error.response?.data?.error_description || error.message}`);
  }
}

// Enhanced error handling function
function logGoogleAdsError(error, context = '') {
  console.error(`\n❌ Google Ads API Error ${context}:`);
  
  if (error.response && error.response.data) {
    const errorData = error.response.data;
    console.error('Status Code:', error.response.status);
    console.error('Error Object:', JSON.stringify(errorData, null, 2));
    return errorData.error?.message || 'Unknown Google Ads API Error';
  } else {
    console.error('Network/Other Error:', error.message);
    return error.message;
  }
}

// **UPDATED: Fetch leads with auto-token generation**
async function fetchLSALeadsLastMinutes(minutes = 5) {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - minutes * 60 * 1000);
  
  // **OFFICIAL GOOGLE ADS API QUERY from documentation**
  const query = `SELECT local_services_lead.lead_type, local_services_lead.category_id, local_services_lead.service_id, local_services_lead.contact_details, local_services_lead.lead_status, local_services_lead.creation_date_time, local_services_lead.locale, local_services_lead.lead_charged, local_services_lead.id, local_services_lead.resource_name FROM local_services_lead ORDER BY local_services_lead.creation_date_time DESC LIMIT 500`;

  const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
  // **AUTO-GENERATE ACCESS TOKEN**
  const accessToken = await getGoogleAccessToken();
  
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json'
  };
  
  if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  }

  console.log(`🔍 Fetching LSA leads and filtering for last ${minutes} minutes`);
  console.log(`⏰ Time cutoff: ${cutoffTime.toISOString()}`);
  console.log('🔧 Official GAQL Query:', query);

  try {
    const response = await axios.post(url, { query }, { headers });
    const allResults = response.data.results || [];
    
    console.log(`📊 Found ${allResults.length} total leads`);
    
    // **CLIENT-SIDE TIME FILTERING (only way to get minute precision)**
    const recentResults = allResults.filter(result => {
      const lead = result.localServicesLead;
      
      // Parse the creation_date_time from Google Ads API format
      const leadTime = new Date(lead.creationDateTime);
      const isRecent = leadTime >= cutoffTime;
      
      if (isRecent) {
        console.log(`✅ Lead ${lead.id} is recent: ${lead.creationDateTime}`);
      }
      
      return isRecent;
    });
    
    console.log(`🎯 Filtered to ${recentResults.length} leads from last ${minutes} minutes`);
    
    return {
      success: true,
      leads: recentResults,
      count: recentResults.length,
      totalCount: allResults.length,
      timeWindow: {
        minutes,
        cutoffTime: cutoffTime.toISOString(),
        currentTime: now.toISOString()
      }
    };
    
  } catch (error) {
    const errorMessage = logGoogleAdsError(error, `while fetching leads for last ${minutes} minutes`);
    
    return {
      success: false,
      error: errorMessage,
      leads: [],
      count: 0,
      timeWindow: {
        minutes,
        cutoffTime: cutoffTime.toISOString(),
        currentTime: now.toISOString()
      }
    };
  }
}

// **UPDATED: Fetch conversations with auto-token generation**
async function fetchLeadConversations(leadResourceName) {
  const query = `SELECT local_services_lead_conversation.id, local_services_lead_conversation.conversation_channel, local_services_lead_conversation.participant_type, local_services_lead_conversation.lead, local_services_lead_conversation.event_date_time, local_services_lead_conversation.phone_call_details.call_duration_millis, local_services_lead_conversation.phone_call_details.call_recording_url, local_services_lead_conversation.message_details.text, local_services_lead_conversation.message_details.attachment_urls FROM local_services_lead_conversation WHERE local_services_lead_conversation.lead = '${leadResourceName}'`;

  const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
  // **AUTO-GENERATE ACCESS TOKEN**
  const accessToken = await getGoogleAccessToken();
  
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json'
  };
  
  if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  }

  try {
    const response = await axios.post(url, { query }, { headers });
    return response.data.results || [];
  } catch (error) {
    logGoogleAdsError(error, `while fetching conversations for lead ${leadResourceName}`);
    return [];
  }
}

// Transform only essential Milestone 2 fields
const transformLeadForLindy = (leadData, conversations = []) => {
  const lead = leadData.localServicesLead;
  
  // Get actual message text from conversation
  const latestConversation = conversations.find(c => 
    c.localServicesLeadConversation?.participantType === 'CONSUMER'
  );
  const actualMessageText = latestConversation?.localServicesLeadConversation?.messageDetails?.text;
  
  const messageText = actualMessageText || 
                      (lead.leadType === 'MESSAGE' ? 'Message content not available' : 
                       lead.leadType === 'PHONE_CALL' ? 'Phone call inquiry' :
                       `${lead.leadType} inquiry`);

  const contactDetails = lead.contactDetails || {};

  return {
    // **MILESTONE 2 REQUIRED FIELDS ONLY**
    leadId: lead.id,
    messageText: messageText,
    sender: latestConversation?.localServicesLeadConversation?.participantType || 'CONSUMER',
    timestamp: lead.creationDateTime,
    contactInfo: {
      name: contactDetails.consumerName || '',
      phone: contactDetails.phoneNumber || '',
      email: contactDetails.email || ''
    }
  };
};

// Send to Lindy webhook
async function sendToLindy(payload) {
  if (!LINDY_WEBHOOK_URL) {
    console.warn('⚠️ Lindy webhook URL not configured');
    return { success: false, error: 'Webhook URL not configured' };
  }

  try {
    const response = await axios.post(LINDY_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LSA-Poller/3.0'
      },
      timeout: 10000
    });
    
    console.log(`✅ Sent leadId ${payload.leadId} to Lindy: ${response.status}`);
    return { 
      success: true, 
      leadId: payload.leadId,
      status: response.status
    };
    
  } catch (error) {
    console.error(`❌ Failed to send leadId ${payload.leadId} to Lindy:`, error.message);
    return { 
      success: false, 
      leadId: payload.leadId,
      error: error.response?.status === 404 ? 'Webhook URL not found (404)' : error.message
    };
  }
}

// Poll leads for last N minutes
async function pollLeadsLastMinutes(minutes = 5) {
  console.log(`\n🔄 Starting LSA polling for last ${minutes} minutes...`);
  
  // Fetch leads with auto-token generation
  const leadsResult = await fetchLSALeadsLastMinutes(minutes);
  
  if (!leadsResult.success) {
    return {
      success: false,
      error: leadsResult.error,
      leads: [],
      processedCount: 0,
      sentCount: 0,
      timeWindow: leadsResult.timeWindow
    };
  }
  
  if (leadsResult.count === 0) {
    console.log(`📭 No leads found in last ${minutes} minutes`);
    return {
      success: true,
      leads: [],
      processedCount: 0,
      sentCount: 0,
      message: `No leads found in last ${minutes} minutes (${leadsResult.totalCount} total leads)`,
      timeWindow: leadsResult.timeWindow
    };
  }
  
  // Process each lead
  const processedLeads = [];
  
  for (const leadData of leadsResult.leads) {
    const lead = leadData.localServicesLead;
    console.log(`🔍 Processing lead ${lead.id} (${lead.leadType}) - ${lead.creationDateTime}`);
    
    // Fetch conversations for MESSAGE type leads
    let conversations = [];
    if (lead.leadType === 'MESSAGE') {
      conversations = await fetchLeadConversations(lead.resourceName);
      console.log(`💬 Found ${conversations.length} conversations for lead ${lead.id}`);
    }
    
    // Transform for Lindy (only essential fields)
    const transformedLead = transformLeadForLindy(leadData, conversations);
    processedLeads.push(transformedLead);
  }
  
  // Send to Lindy
  const lindyResults = [];
  for (const lead of processedLeads) {
    const result = await sendToLindy(lead);
    lindyResults.push(result);
  }
  
  const sentCount = lindyResults.filter(r => r.success).length;
  console.log(`✅ Processing complete: ${sentCount}/${processedLeads.length} sent to Lindy\n`);
  
  return {
    success: true,
    leads: processedLeads,
    lindyResults,
    processedCount: processedLeads.length,
    sentCount,
    timeWindow: leadsResult.timeWindow,
    totalCount: leadsResult.totalCount,
    timestamp: new Date().toISOString()
  };
}

// ===== GOHIGHLEVEL INTEGRATION FUNCTIONS =====

/**
 * 1. UPSERT CONTACT IN GOHIGHLEVEL (Official API)
 */
async function upsertGHLContact(lsaLead) {
  const contactPayload = {
    firstName: lsaLead.contactInfo.name || 'LSA Lead',
    phone: lsaLead.contactInfo.phone || '',
    email: lsaLead.contactInfo.email || '',
    locationId: GHL_LOCATION_ID,
    source: 'Google LSA',
    tags: ['lsa-lead', 'legal-consultation'],
    customFields: {
      lsa_lead_id: lsaLead.leadId,
      lsa_message: lsaLead.messageText,
      lsa_timestamp: lsaLead.timestamp
    }
  };

  const headers = {
    'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Version': '2021-04-15'
  };

  try {
    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      contactPayload,
      { headers }
    );
    
    console.log(`✅ Created GHL contact: ${response.data.contact.id}`);
    return {
      success: true,
      contact: response.data.contact,
      contactId: response.data.contact.id
    };
    
  } catch (error) {
    console.error('❌ Contact creation failed:', error.response?.data);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * 2. FETCH CALENDAR AVAILABILITY (Official API)
 */
async function fetchCalendarAvailability(calendarId, date = null) {
  if (!date) {
    date = new Date().toISOString().split('T'); // Today
  }

  const headers = {
    'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
    'Version': '2021-04-15'
  };

  try {
    // Get calendar free slots
    const response = await axios.get(
      `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${date}&endDate=${date}&timezone=America/New_York`,
      { headers }
    );
    
    console.log(`📅 Found ${response.data.slots?.length || 0} free slots for ${calendarId}`);
    
    return {
      success: true,
      calendarId,
      date,
      slots: response.data.slots || [],
      availableCount: response.data.slots?.length || 0
    };
    
  } catch (error) {
    console.error(`❌ Failed to fetch availability:`, error.response?.data);
    return {
      success: false,
      calendarId,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * 3. CREATE APPOINTMENT (Official API)
 */
async function createGHLAppointment(contactId, calendarId, startTime, endTime, notes = '') {
  const appointmentPayload = {
    calendarId: calendarId,
    contactId: contactId,
    startTime: startTime,
    endTime: endTime,
    title: 'LSA Legal Consultation',
    appointmentStatus: 'confirmed',
    notes: notes || 'Appointment created from LSA lead via Lindy',
    source: 'api'
  };

  const headers = {
    'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Version': '2021-04-15'
  };

  try {
    const response = await axios.post(
      'https://services.leadconnectorhq.com/calendars/events/appointments',
      appointmentPayload,
      { headers }
    );
    
    console.log(`✅ Created appointment: ${response.data.id}`);
    return {
      success: true,
      appointment: response.data,
      appointmentId: response.data.id
    };
    
  } catch (error) {
    console.error('❌ Appointment creation failed:', error.response?.data);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

// ===== NEW API ENDPOINTS FOR LINDY INTEGRATION =====

/**
 * LINDY ENDPOINT 1: Create Contact in GoHighLevel
 */
app.post('/lindy/create-contact', async (req, res) => {
  try {
    const lsaLead = req.body;
    
    if (!lsaLead.leadId || !lsaLead.contactInfo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: leadId, contactInfo'
      });
    }
    
    const result = await upsertGHLContact(lsaLead);
    
    res.json({
      success: result.success,
      contact: result.contact,
      contactId: result.contactId,
      error: result.error,
      timestamp: new Date().toISOString(),
      endpoint: 'create-contact'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * LINDY ENDPOINT 2: Fetch Calendar Availability for Both Calendars
 */
app.post('/lindy/check-availability', async (req, res) => {
  try {
    const { date, serviceType } = req.body;
    const checkDate = date || new Date().toISOString().split('T');
    
    // Check both calendars simultaneously
    const [probateAvailability, estateAvailability] = await Promise.all([
      fetchCalendarAvailability(PROBATE_CALENDAR_ID, checkDate),
      fetchCalendarAvailability(ESTATE_PLANNING_CALENDAR_ID, checkDate)
    ]);
    
    // Determine recommended calendar based on service type
    let recommendedCalendar = 'probate';
    if (serviceType && (serviceType.includes('estate') || serviceType.includes('trust') || serviceType.includes('will'))) {
      recommendedCalendar = 'estate_planning';
    }
    
    res.json({
      success: true,
      date: checkDate,
      calendars: {
        probate: {
          calendarId: PROBATE_CALENDAR_ID,
          available: probateAvailability.success,
          slots: probateAvailability.slots || [],
          availableCount: probateAvailability.availableCount || 0
        },
        estate_planning: {
          calendarId: ESTATE_PLANNING_CALENDAR_ID,
          available: estateAvailability.success,
          slots: estateAvailability.slots || [],
          availableCount: estateAvailability.availableCount || 0
        }
      },
      recommendation: {
        calendar: recommendedCalendar,
        calendarId: recommendedCalendar === 'probate' ? PROBATE_CALENDAR_ID : ESTATE_PLANNING_CALENDAR_ID,
        hasSlots: recommendedCalendar === 'probate' ? probateAvailability.availableCount > 0 : estateAvailability.availableCount > 0
      },
      timestamp: new Date().toISOString(),
      endpoint: 'check-availability'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * LINDY ENDPOINT 3: Create Appointment in Selected Calendar
 */
app.post('/lindy/create-appointment', async (req, res) => {
  try {
    const { contactId, calendarId, startTime, endTime, notes, leadId } = req.body;
    
    if (!contactId || !calendarId || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: contactId, calendarId, startTime, endTime'
      });
    }
    
    const result = await createGHLAppointment(contactId, calendarId, startTime, endTime, notes);
    
    res.json({
      success: result.success,
      appointment: result.appointment,
      appointmentId: result.appointmentId,
      calendarType: calendarId === PROBATE_CALENDAR_ID ? 'Probate' : 'Estate Planning',
      error: result.error,
      leadId: leadId,
      timestamp: new Date().toISOString(),
      endpoint: 'create-appointment'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * LINDY ENDPOINT 4: Complete Workflow (All-in-One)
 */
app.post('/lindy/complete-workflow', async (req, res) => {
  try {
    const lsaLead = req.body;
    
    console.log(`🔄 Starting complete workflow for lead ${lsaLead.leadId}`);
    
    // Step 1: Create contact
    const contactResult = await upsertGHLContact(lsaLead);
    if (!contactResult.success) {
      return res.status(500).json({
        success: false,
        step: 'create-contact',
        error: contactResult.error
      });
    }
    
    // Step 2: Check availability for next 3 days
    const today = new Date();
    const availabilityPromises = [];
    
    for (let i = 0; i < 3; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() + i);
      const dateStr = checkDate.toISOString().split('T');
      
      availabilityPromises.push(
        Promise.all([
          fetchCalendarAvailability(PROBATE_CALENDAR_ID, dateStr),
          fetchCalendarAvailability(ESTATE_PLANNING_CALENDAR_ID, dateStr)
        ]).then(([probate, estate]) => ({
          date: dateStr,
          probate,
          estate
        }))
      );
    }
    
    const availability = await Promise.all(availabilityPromises);
    
    // Step 3: Auto-book first available slot if exists
    let appointment = null;
    let calendarUsed = null;
    
    // Try to find first available slot
    for (const day of availability) {
      if (day.probate.success && day.probate.slots.length > 0) {
        const slot = day.probate.slots;
        appointment = await createGHLAppointment(
          contactResult.contactId,
          PROBATE_CALENDAR_ID,
          slot.startTime,
          slot.endTime,
          `Auto-booked from LSA lead ${lsaLead.leadId}`
        );
        calendarUsed = 'Probate';
        break;
      } else if (day.estate.success && day.estate.slots.length > 0) {
        const slot = day.estate.slots;
        appointment = await createGHLAppointment(
          contactResult.contactId,
          ESTATE_PLANNING_CALENDAR_ID,
          slot.startTime,
          slot.endTime,
          `Auto-booked from LSA lead ${lsaLead.leadId}`
        );
        calendarUsed = 'Estate Planning';
        break;
      }
    }
    
    res.json({
      success: true,
      leadId: lsaLead.leadId,
      contact: {
        created: true,
        contactId: contactResult.contactId,
        name: contactResult.contact.firstName,
        phone: contactResult.contact.phone,
        email: contactResult.contact.email
      },
      availability: availability.map(day => ({
        date: day.date,
        probateSlots: day.probate.availableCount || 0,
        estateSlots: day.estate.availableCount || 0
      })),
      appointment: appointment ? {
        created: true,
        appointmentId: appointment.appointmentId,
        calendar: calendarUsed,
        startTime: appointment.appointment.startTime,
        endTime: appointment.appointment.endTime
      } : {
        created: false,
        reason: 'No available slots found in next 3 days'
      },
      timestamp: new Date().toISOString(),
      endpoint: 'complete-workflow'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add to your existing health check
app.get('/api/health', async (req, res) => {
  try {
    const accessToken = await getGoogleAccessToken();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      tokenSystem: {
        status: 'working',
        hasValidToken: !!accessToken,
        tokenExpiresAt: new Date(tokenCache.expiresAt).toISOString(),
        autoRefreshEnabled: true
      },
      integrations: {
        googleAds: {
          hasCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
          customerId: GOOGLE_ADS_CUSTOMER_ID
        },
        lindy: {
          hasWebhook: !!LINDY_WEBHOOK_URL
        },
        goHighLevel: {
          hasToken: !!GHL_ACCESS_TOKEN,
          locationId: GHL_LOCATION_ID,
          calendars: {
            probate: PROBATE_CALENDAR_ID,
            estatePlanning: ESTATE_PLANNING_CALENDAR_ID
          }
        }
      },
      lindyEndpoints: [
        'POST /lindy/create-contact',
        'POST /lindy/check-availability', 
        'POST /lindy/create-appointment',
        'POST /lindy/complete-workflow'
      ]
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});
// ===== API ENDPOINTS =====

// Poll last 5 minutes (for cron)
app.get('/api/poll/recent', async (req, res) => {
  const result = await pollLeadsLastMinutes(250);
  res.json(result);
});

// Get leads from last N minutes
app.get('/api/leads/last/:minutes', async (req, res) => {
  const minutes = parseInt(req.params.minutes) || 5;
  
  if (minutes < 1 || minutes > 1440) {
    return res.status(400).json({
      success: false,
      error: 'Minutes must be between 1 and 1440 (24 hours)'
    });
  }
  
  const result = await pollLeadsLastMinutes(minutes);
  res.json(result);
});

// **NEW: Token status endpoint**
app.get('/api/token-status', async (req, res) => {
  try {
    const accessToken = await getGoogleAccessToken();
    
    res.json({
      success: true,
      tokenStatus: {
        hasToken: !!accessToken,
        tokenLength: accessToken ? accessToken.length : 0,
        expiresAt: new Date(tokenCache.expiresAt).toISOString(),
        expiresInSeconds: Math.max(0, Math.floor((tokenCache.expiresAt - Date.now()) / 1000)),
        isExpired: Date.now() >= tokenCache.expiresAt
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
    // Test token generation
    const accessToken = await getGoogleAccessToken();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      tokenSystem: {
        status: 'working',
        hasValidToken: !!accessToken,
        tokenExpiresAt: new Date(tokenCache.expiresAt).toISOString(),
        autoRefreshEnabled: true
      },
      config: {
        hasGoogleCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
        hasLindyWebhook: !!LINDY_WEBHOOK_URL,
        customerId: GOOGLE_ADS_CUSTOMER_ID,
        port: PORT
      },
      note: 'Using auto-refreshing Google OAuth tokens'
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      tokenSystem: {
        status: 'failed',
        error: error.message
      }
    });
  }
});

// API documentation
app.get('/api', (req, res) => {
  res.json({
    message: 'LSA Message Retrieval API - Auto-Refreshing Tokens',
    version: '4.0.0',
    features: [
      'Auto-generating Google access tokens',
      'Automatic token refresh on expiry',
      'No manual token management needed',
      'Official Google Ads API implementation'
    ],
    endpoints: {
      'GET /api/poll/recent': 'Poll leads from last 5 minutes (for cron job)',
      'GET /api/leads/last/:minutes': 'Get leads from last N minutes (1-1440)',
      'GET /api/token-status': 'Check current token status and expiry',
      'GET /api/health': 'Check system health and token system'
    },
    examples: {
      'Poll recent for cron': `GET ${req.protocol}://${req.get('host')}/api/poll/recent`,
      'Get last 30 minutes': `GET ${req.protocol}://${req.get('host')}/api/leads/last/30`,
      'Check token status': `GET ${req.protocol}://${req.get('host')}/api/token-status`
    },
    tokenManagement: {
      system: 'Auto-refreshing OAuth2',
      provider: 'Google OAuth2 API',
      refreshBuffer: '60 seconds before expiry',
      caching: 'In-memory with expiry tracking'
    }
  });
});

// **CRON JOB: Auto-poll every 5 minutes**
if (process.env.NODE_ENV !== 'test') {
  cron.schedule('*/5 * * * *', async () => {
    console.log('🕐 Automated 5-minute polling triggered...');
    try {
      const result = await pollLeadsLastMinutes(5);
      console.log(`⏰ Cron result: ${result.processedCount} processed, ${result.sentCount} sent`);
    } catch (error) {
      console.error('❌ Cron job failed:', error.message);
    }
  });
  
  console.log('⏰ Cron job scheduled: Every 5 minutes');
}

app.listen(PORT, () => {
  console.log(`🚀 LSA Message Retrieval Server running on http://localhost:${PORT}`);
  console.log(`📊 Customer ID: ${GOOGLE_ADS_CUSTOMER_ID}`);
  console.log(`🔗 Lindy Webhook: ${LINDY_WEBHOOK_URL ? 'Configured ✅' : 'Not configured ❌'}`);
  console.log(`🔑 Token System: Auto-refreshing OAuth2 ✅`);
  console.log(`\n📋 API Endpoints:`);
  console.log(`   GET  http://localhost:${PORT}/api/poll/recent`);
  console.log(`   GET  http://localhost:${PORT}/api/leads/last/30`);
  console.log(`   GET  http://localhost:${PORT}/api/token-status`);
  console.log(`\n✅ Automatic token refresh system enabled`);
});

module.exports = app;
