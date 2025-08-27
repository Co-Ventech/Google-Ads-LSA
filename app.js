// require('dotenv').config();
// const express = require('express');
// const axios = require('axios');
// const path = require('path');
// const fs = require('fs').promises;
// const cron = require('node-cron');
// const qs = require('querystring');

// const app = express();
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// const PORT = process.env.PORT || 3000;

// // ===== UPDATED ENVIRONMENT VARIABLES =====
// const {
//   GOOGLE_CLIENT_ID,          // Add these to your .env
//   GOOGLE_CLIENT_SECRET,      // Add these to your .env  
//   GOOGLE_REFRESH_TOKEN,      // Add these to your .env
//   GOOGLE_ADS_DEVELOPER_TOKEN,
//   GOOGLE_ADS_CUSTOMER_ID,
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID,
//   LINDY_WEBHOOK_URL,
//   GHL_ACCESS_TOKEN,
//   GHL_LOCATION_ID,
//   PROBATE_CALENDAR_ID,
//   ESTATE_PLANNING_CALENDAR_ID
// } = process.env;

// // ===== TOKEN MANAGEMENT SYSTEM =====
// let tokenCache = {
//   accessToken: null,
//   expiresAt: 0
// };

// /**
//  * Auto-generates Google Access Token using Client ID/Secret
//  * Automatically refreshes when token expires
//  */
// async function getGoogleAccessToken() {
//   const now = Date.now();
  
//   // Return cached token if still valid (with 60-second buffer)
//   if (tokenCache.accessToken && now < tokenCache.expiresAt - 60000) {
//     console.log('✅ Using cached access token');
//     return tokenCache.accessToken;
//   }

//   console.log('🔄 Auto-generating new Google access token...');
  
//   if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
//     throw new Error('Missing required Google OAuth credentials in environment variables');
//   }

//   try {
//     // Use Google OAuth2 endpoint to refresh token
//     const response = await axios.post(
//       'https://oauth2.googleapis.com/token',
//       qs.stringify({
//         client_id: GOOGLE_CLIENT_ID,
//         client_secret: GOOGLE_CLIENT_SECRET,
//         refresh_token: GOOGLE_REFRESH_TOKEN,
//         grant_type: 'refresh_token'
//       }),
//       {
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded'
//         }
//       }
//     );

//     // Cache the new token
//     tokenCache.accessToken = response.data.access_token;
//     tokenCache.expiresAt = now + (response.data.expires_in * 1000);
    
//     console.log(`✅ New access token generated successfully`);
//     console.log(`⏰ Token expires in ${response.data.expires_in} seconds`);
//     console.log(`🕒 Token expires at: ${new Date(tokenCache.expiresAt).toISOString()}`);
    
//     return tokenCache.accessToken;
    
//   } catch (error) {
//     console.error('❌ Failed to generate access token:', error.response?.data || error.message);
//     throw new Error(`Token generation failed: ${error.response?.data?.error_description || error.message}`);
//   }
// }

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

// // **UPDATED: Fetch leads with auto-token generation**
// async function fetchLSALeadsLastMinutes(minutes = 5) {
//   const now = new Date();
//   const cutoffTime = new Date(now.getTime() - minutes * 60 * 1000);
  
//   // **OFFICIAL GOOGLE ADS API QUERY from documentation**
//   const query = `SELECT local_services_lead.lead_type, local_services_lead.category_id, local_services_lead.service_id, local_services_lead.contact_details, local_services_lead.lead_status, local_services_lead.creation_date_time, local_services_lead.locale, local_services_lead.lead_charged, local_services_lead.id, local_services_lead.resource_name FROM local_services_lead ORDER BY local_services_lead.creation_date_time DESC LIMIT 500`;

//   const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
//   // **AUTO-GENERATE ACCESS TOKEN**
//   const accessToken = await getGoogleAccessToken();
  
//   const headers = {
//     'Authorization': `Bearer ${accessToken}`,
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

// // **UPDATED: Fetch conversations with auto-token generation**
// async function fetchLeadConversations(leadResourceName) {
//   const query = `SELECT local_services_lead_conversation.id, local_services_lead_conversation.conversation_channel, local_services_lead_conversation.participant_type, local_services_lead_conversation.lead, local_services_lead_conversation.event_date_time, local_services_lead_conversation.phone_call_details.call_duration_millis, local_services_lead_conversation.phone_call_details.call_recording_url, local_services_lead_conversation.message_details.text, local_services_lead_conversation.message_details.attachment_urls FROM local_services_lead_conversation WHERE local_services_lead_conversation.lead = '${leadResourceName}'`;

//   const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
//   // **AUTO-GENERATE ACCESS TOKEN**
//   const accessToken = await getGoogleAccessToken();
  
//   const headers = {
//     'Authorization': `Bearer ${accessToken}`,
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

// // Transform only essential Milestone 2 fields
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

// // Poll leads for last N minutes
// async function pollLeadsLastMinutes(minutes = 5) {
//   console.log(`\n🔄 Starting LSA polling for last ${minutes} minutes...`);
  
//   // Fetch leads with auto-token generation
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

// /**
//  * 1. UPSERT CONTACT IN GOHIGHLEVEL (CORRECTED FORMAT)
//  */
// async function upsertGHLContact(lsaLead) {
//   const contactPayload = {
//     locationId: GHL_LOCATION_ID,
//     firstName: lsaLead.contactInfo.name || 'LSA Lead',
//     phone: lsaLead.contactInfo.phone || '',
//     email: lsaLead.contactInfo.email || '',
//     source: 'Google LSA',
//     tags: ['lsa-lead', 'legal-consultation'],
//     // ✅ CORRECTED: customFields must be an array
//     customFields: [
//       {
//         id: 'lsa_lead_id', // Use your actual custom field ID
//         field_value: lsaLead.leadId
//       },
//       {
//         id: 'lsa_message', // Use your actual custom field ID  
//         field_value: lsaLead.messageText
//       },
//       {
//         id: 'lsa_timestamp', // Use your actual custom field ID
//         field_value: lsaLead.timestamp
//       }
//     ]
//   };

//   const headers = {
//     'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
//     'Content-Type': 'application/json',
//     'Version': '2021-04-15'
//   };

//   try {
//     // Use the UPSERT endpoint from official docs
//     const response = await axios.post(
//       'https://services.leadconnectorhq.com/contacts/upsert',
//       contactPayload,
//       { headers }
//     );
    
//     console.log(`✅ Upserted GHL contact: ${response.data.contact.id}`);
//     return {
//       success: true,
//       contact: response.data.contact,
//       contactId: response.data.contact.id
//     };
    
//   } catch (error) {
//     console.error('❌ Contact upsert failed:', error.response?.data);
//     return {
//       success: false,
//       error: error.response?.data?.message || error.message
//     };
//   }
// }
// /**
//  * Helper function to convert date string to Unix timestamps
//  */
// function getUnixTimestamps(dateString) {
//   const startOfDay = new Date(`${dateString}T00:00:00.000Z`);
//   const endOfDay = new Date(`${dateString}T23:59:59.999Z`);
  
//   return {
//     startDate: startOfDay.getTime(),
//     endDate: endOfDay.getTime(),
//     startISO: startOfDay.toISOString(),
//     endISO: endOfDay.toISOString()
//   };
// }

// /**
//  * Updated Calendar Availability with Helper
//  */
// async function fetchCalendarAvailability(calendarId, date = null) {
//   if (!date) {
//     date = new Date().toISOString().split('T')[0]; // Today
//   }

//   const timestamps = getUnixTimestamps(date);
  
//   const headers = {
//     'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
//     'Version': '2021-04-15'
//   };

//   console.log(`📅 Checking calendar ${calendarId} for ${date}`);
//   console.log(`🕐 Timestamps: ${timestamps.startDate} to ${timestamps.endDate}`);

//   try {
//     const response = await axios.get(
//       `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`,
//       { 
//         headers,
//         params: {
//           startDate: timestamps.startDate,  // Unix timestamp
//           endDate: timestamps.endDate,      // Unix timestamp
//           timezone: 'America/New_York'
//         }
//       }
//     );
    
//     const slots = response.data._dates_?.slots || response.data.slots || [];
    
//     return {
//       success: true,
//       calendarId,
//       date,
//       slots: slots,
//       availableCount: slots.length
//     };
    
//   } catch (error) {
//     console.error(`❌ Calendar availability error:`, error.response?.data);
//     return {
//       success: false,
//       calendarId,
//       error: error.response?.data?.message || error.message
//     };
//   }
// }

// /**
//  * 2. FETCH CALENDAR AVAILABILITY (CORRECTED - Unix Timestamps)
//  */
// async function fetchCalendarAvailability(calendarId, date = null) {
//   if (!date) {
//     date = new Date().toISOString().split('T')[0]; // Today (YYYY-MM-DD format)
//   }

//   // ✅ CORRECTED: Convert date string to Unix timestamps (numbers)
//   const startOfDay = new Date(`${date}T00:00:00.000Z`);
//   const endOfDay = new Date(`${date}T23:59:59.999Z`);
  
//   const startDate = startOfDay.getTime(); // Unix timestamp in milliseconds
//   const endDate = endOfDay.getTime();     // Unix timestamp in milliseconds

//   const headers = {
//     'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
//     'Version': '2021-04-15'
//   };

//   console.log(`📅 Checking calendar ${calendarId} for date ${date}`);
//   console.log(`🕐 StartDate: ${startDate} (${startOfDay.toISOString()})`);
//   console.log(`🕐 EndDate: ${endDate} (${endOfDay.toISOString()})`);

//   try {
//     const response = await axios.get(
//       `https://services.leadconnectorhq.com/calendars/${calendarId}/free-slots`,
//       { 
//         headers,
//         params: {
//           startDate: startDate,    // ✅ Unix timestamp (number)
//           endDate: endDate,        // ✅ Unix timestamp (number)
//           timezone: 'America/New_York'
//         }
//       }
//     );
    
//     const slots = response.data._dates_?.slots || response.data.slots || [];
//     console.log(`📊 Found ${slots.length} free slots for calendar ${calendarId}`);
    
//     return {
//       success: true,
//       calendarId,
//       date,
//       slots: slots,
//       availableCount: slots.length,
//       rawResponse: response.data
//     };
    
//   } catch (error) {
//     console.error(`❌ Failed to fetch availability for ${calendarId}:`, error.response?.data);
//     return {
//       success: false,
//       calendarId,
//       date,
//       error: error.response?.data?.message || error.message,
//       slots: [],
//       availableCount: 0
//     };
//   }
// }
// /**
//  * 3. CREATE APPOINTMENT (CORRECTED ENDPOINT)
//  */
// async function createGHLAppointment(contactId, calendarId, startTime, endTime, notes = '') {
//   const appointmentPayload = {
//     locationId: GHL_LOCATION_ID,
//     calendarId: calendarId,
//     contactId: contactId,
//     startTime: startTime,
//     endTime: endTime,
//     title: 'LSA Legal Consultation',
//     appointmentStatus: 'confirmed',
//     notes: notes || 'Appointment created from LSA lead'
//   };

//   const headers = {
//     'Authorization': `Bearer ${GHL_ACCESS_TOKEN}`,
//     'Content-Type': 'application/json',
//     'Version': '2021-04-15'
//   };

//   try {
//     // Use the correct appointments endpoint
//     const response = await axios.post(
//       'https://services.leadconnectorhq.com/appointments',
//       appointmentPayload,
//       { headers }
//     );
    
//     console.log(`✅ Created appointment: ${response.data.id}`);
//     return {
//       success: true,
//       appointment: response.data,
//       appointmentId: response.data.id
//     };
    
//   } catch (error) {
//     console.error('❌ Appointment creation failed:', error.response?.data);
//     return {
//       success: false,
//       error: error.response?.data?.message || error.message
//     };
//   }
// }

// // ===== NEW API ENDPOINTS FOR LINDY INTEGRATION =====

// /**
//  * LINDY ENDPOINT 1: Create Contact in GoHighLevel
//  */
// // app.post('/lindy/create-contact', async (req, res) => {
// //   try {
// //     const lsaLead = req.body;
    
// //     if (!lsaLead.leadId || !lsaLead.contactInfo) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required fields: leadId, contactInfo'
// //       });
// //     }
    
// //     const result = await upsertGHLContact(lsaLead);
    
// //     res.json({
// //       success: result.success,
// //       contact: result.contact,
// //       contactId: result.contactId,
// //       error: result.error,
// //       timestamp: new Date().toISOString(),
// //       endpoint: 'create-contact'
// //     });
    
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * LINDY ENDPOINT 2: Fetch Calendar Availability for Both Calendars
// //  */
// // app.post('/lindy/check-availability', async (req, res) => {
// //   try {
// //     const { date, serviceType } = req.body;
// //     const checkDate = date || new Date().toISOString().split('T');
    
// //     // Check both calendars simultaneously
// //     const [probateAvailability, estateAvailability] = await Promise.all([
// //       fetchCalendarAvailability(PROBATE_CALENDAR_ID, checkDate),
// //       fetchCalendarAvailability(ESTATE_PLANNING_CALENDAR_ID, checkDate)
// //     ]);
    
// //     // Determine recommended calendar based on service type
// //     let recommendedCalendar = 'probate';
// //     if (serviceType && (serviceType.includes('estate') || serviceType.includes('trust') || serviceType.includes('will'))) {
// //       recommendedCalendar = 'estate_planning';
// //     }
    
// //     res.json({
// //       success: true,
// //       date: checkDate,
// //       calendars: {
// //         probate: {
// //           calendarId: PROBATE_CALENDAR_ID,
// //           available: probateAvailability.success,
// //           slots: probateAvailability.slots || [],
// //           availableCount: probateAvailability.availableCount || 0
// //         },
// //         estate_planning: {
// //           calendarId: ESTATE_PLANNING_CALENDAR_ID,
// //           available: estateAvailability.success,
// //           slots: estateAvailability.slots || [],
// //           availableCount: estateAvailability.availableCount || 0
// //         }
// //       },
// //       recommendation: {
// //         calendar: recommendedCalendar,
// //         calendarId: recommendedCalendar === 'probate' ? PROBATE_CALENDAR_ID : ESTATE_PLANNING_CALENDAR_ID,
// //         hasSlots: recommendedCalendar === 'probate' ? probateAvailability.availableCount > 0 : estateAvailability.availableCount > 0
// //       },
// //       timestamp: new Date().toISOString(),
// //       endpoint: 'check-availability'
// //     });
    
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * LINDY ENDPOINT 3: Create Appointment in Selected Calendar
// //  */
// // app.post('/lindy/create-appointment', async (req, res) => {
// //   try {
// //     const { contactId, calendarId, startTime, endTime, notes, leadId } = req.body;
    
// //     if (!contactId || !calendarId || !startTime || !endTime) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required fields: contactId, calendarId, startTime, endTime'
// //       });
// //     }
    
// //     const result = await createGHLAppointment(contactId, calendarId, startTime, endTime, notes);
    
// //     res.json({
// //       success: result.success,
// //       appointment: result.appointment,
// //       appointmentId: result.appointmentId,
// //       calendarType: calendarId === PROBATE_CALENDAR_ID ? 'Probate' : 'Estate Planning',
// //       error: result.error,
// //       leadId: leadId,
// //       timestamp: new Date().toISOString(),
// //       endpoint: 'create-appointment'
// //     });
    
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });



// // // ===== CORRECTED API ENDPOINTS FOR LINDY =====

// // /**
// //  * LINDY ENDPOINT 1: Create Contact in GoHighLevel (FIXED)
// //  */
// // app.post('/lindy/create-contact', async (req, res) => {
// //   try {
// //     const lsaLead = req.body;
    
// //     if (!lsaLead.leadId || !lsaLead.contactInfo) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required fields: leadId, contactInfo'
// //       });
// //     }
    
// //     const result = await upsertGHLContact(lsaLead);
    
// //     res.json({
// //       success: result.success,
// //       contact: result.contact,
// //       contactId: result.contactId,
// //       error: result.error,
// //       timestamp: new Date().toISOString(),
// //       endpoint: 'create-contact'
// //     });
    
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * LINDY ENDPOINT 2: Check Calendar Availability (FIXED)
// //  */
// // app.post('/lindy/check-availability', async (req, res) => {
// //   try {
// //     const { date, serviceType } = req.body;
// //     const checkDate = date || new Date().toISOString().split('T');
    
// //     // Check both calendars
// //     const [probateAvailability, estateAvailability] = await Promise.all([
// //       fetchCalendarAvailability(PROBATE_CALENDAR_ID, checkDate),
// //       fetchCalendarAvailability(ESTATE_PLANNING_CALENDAR_ID, checkDate)
// //     ]);
    
// //     res.json({
// //       success: true,
// //       date: checkDate,
// //       calendars: {
// //         probate: probateAvailability,
// //         estate_planning: estateAvailability
// //       },
// //       recommendation: {
// //         calendar: serviceType?.includes('probate') ? 'probate' : 'estate_planning',
// //         calendarId: serviceType?.includes('probate') ? PROBATE_CALENDAR_ID : ESTATE_PLANNING_CALENDAR_ID
// //       },
// //       timestamp: new Date().toISOString()
// //     });
    
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * LINDY ENDPOINT 3: Create Appointment (FIXED)
// //  */
// // app.post('/lindy/create-appointment', async (req, res) => {
// //   try {
// //     const { contactId, calendarId, startTime, endTime, notes, leadId } = req.body;
    
// //     if (!contactId || !calendarId || !startTime || !endTime) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required fields: contactId, calendarId, startTime, endTime'
// //       });
// //     }
    
// //     const result = await createGHLAppointment(contactId, calendarId, startTime, endTime, notes);
    
// //     res.json({
// //       success: result.success,
// //       appointment: result.appointment,
// //       appointmentId: result.appointmentId,
// //       error: result.error,
// //       leadId: leadId,
// //       timestamp: new Date().toISOString()
// //     });
    
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });
// // /**
// //  * LINDY ENDPOINT 4: Complete Workflow (All-in-One)
// //  */
// // /**
// //  * LINDY ENDPOINT 4: Complete Workflow (Updated)
// //  */
// // app.post('/lindy/complete-workflow', async (req, res) => {
// //   try {
// //     const lsaLead = req.body;
    
// //     console.log(`🔄 Starting complete workflow for lead ${lsaLead.leadId}`);
    
// //     // Step 1: Create contact
// //     const contactResult = await upsertGHLContact(lsaLead);
// //     if (!contactResult.success) {
// //       return res.status(500).json({
// //         success: false,
// //         step: 'create-contact',
// //         error: contactResult.error
// //       });
// //     }
    
// //     // Step 2: Check availability for next 3 days
// //     const today = new Date();
// //     const availabilityResults = [];
    
// //     for (let i = 0; i < 3; i++) {
// //       const checkDate = new Date(today);
// //       checkDate.setDate(today.getDate() + i);
// //       const dateStr = checkDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
// //       console.log(`📅 Checking availability for ${dateStr}`);
      
// //       const [probateAvailability, estateAvailability] = await Promise.all([
// //         fetchCalendarAvailability(PROBATE_CALENDAR_ID, dateStr),
// //         fetchCalendarAvailability(ESTATE_PLANNING_CALENDAR_ID, dateStr)
// //       ]);
      
// //       availabilityResults.push({
// //         date: dateStr,
// //         probate: probateAvailability,
// //         estate: estateAvailability
// //       });
// //     }
    
// //     // Step 3: Try to auto-book first available slot
// //     let appointment = null;
// //     let calendarUsed = null;
    
// //     for (const day of availabilityResults) {
// //       // Try probate calendar first
// //       if (day.probate.success && day.probate.slots.length > 0) {
// //         const slot = day.probate.slots[0];
// //         appointment = await createGHLAppointment(
// //           contactResult.contactId,
// //           PROBATE_CALENDAR_ID,
// //           slot,
// //           slot, // You may need to calculate endTime based on slot duration
// //           `Auto-booked from LSA lead ${lsaLead.leadId}`
// //         );
// //         calendarUsed = 'Probate';
// //         break;
// //       }
// //       // Try estate planning calendar
// //       else if (day.estate.success && day.estate.slots.length > 0) {
// //         const slot = day.estate.slots[0];
// //         appointment = await createGHLAppointment(
// //           contactResult.contactId,
// //           ESTATE_PLANNING_CALENDAR_ID,
// //           slot,
// //           slot, // You may need to calculate endTime based on slot duration
// //           `Auto-booked from LSA lead ${lsaLead.leadId}`
// //         );
// //         calendarUsed = 'Estate Planning';
// //         break;
// //       }
// //     }
    
// //     res.json({
// //       success: true,
// //       leadId: lsaLead.leadId,
// //       contact: {
// //         created: true,
// //         contactId: contactResult.contactId,
// //         name: contactResult.contact.firstName
// //       },
// //       availability: availabilityResults.map(day => ({
// //         date: day.date,
// //         probateSlots: day.probate.availableCount || 0,
// //         estateSlots: day.estate.availableCount || 0
// //       })),
// //       appointment: appointment ? {
// //         created: appointment.success,
// //         appointmentId: appointment.appointmentId,
// //         calendar: calendarUsed
// //       } : {
// //         created: false,
// //         reason: 'No available slots found'
// //       },
// //       timestamp: new Date().toISOString()
// //     });
    
// //   } catch (error) {
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // Add to your existing health check
// app.get('/api/health', async (req, res) => {
//   try {
//     const accessToken = await getGoogleAccessToken();
    
//     res.json({
//       status: 'healthy',
//       timestamp: new Date().toISOString(),
//       tokenSystem: {
//         status: 'working',
//         hasValidToken: !!accessToken,
//         tokenExpiresAt: new Date(tokenCache.expiresAt).toISOString(),
//         autoRefreshEnabled: true
//       },
//       integrations: {
//         googleAds: {
//           hasCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
//           customerId: GOOGLE_ADS_CUSTOMER_ID
//         },
//         lindy: {
//           hasWebhook: !!LINDY_WEBHOOK_URL
//         },
//         goHighLevel: {
//           hasToken: !!GHL_ACCESS_TOKEN,
//           locationId: GHL_LOCATION_ID,
//           calendars: {
//             probate: PROBATE_CALENDAR_ID,
//             estatePlanning: ESTATE_PLANNING_CALENDAR_ID
//           }
//         }
//       },
//       lindyEndpoints: [
//         'POST /lindy/create-contact',
//         'POST /lindy/check-availability', 
//         'POST /lindy/create-appointment',
//         'POST /lindy/complete-workflow'
//       ]
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       status: 'error',
//       error: error.message
//     });
//   }
// });
// // ===== API ENDPOINTS =====

// // Poll last 5 minutes (for cron)
// app.get('/api/poll/recent', async (req, res) => {
//   const result = await pollLeadsLastMinutes(250);
//   res.json(result);
// });

// // Get leads from last N minutes
// app.get('/api/leads/last/:minutes', async (req, res) => {
//   const minutes = parseInt(req.params.minutes) || 5;
  
//   if (minutes < 1 || minutes > 43200) {
//     return res.status(400).json({
//       success: false,
//       error: 'Minutes must be between 1 and 43200 (24 hours x 30 days)'
//     });
//   }
  
//   const result = await pollLeadsLastMinutes(minutes);
//   res.json(result);
// });

// // **NEW: Token status endpoint**
// app.get('/api/token-status', async (req, res) => {
//   try {
//     const accessToken = await getGoogleAccessToken();
    
//     res.json({
//       success: true,
//       tokenStatus: {
//         hasToken: !!accessToken,
//         tokenLength: accessToken ? accessToken.length : 0,
//         expiresAt: new Date(tokenCache.expiresAt).toISOString(),
//         expiresInSeconds: Math.max(0, Math.floor((tokenCache.expiresAt - Date.now()) / 1000)),
//         isExpired: Date.now() >= tokenCache.expiresAt
//       },
//       timestamp: new Date().toISOString()
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// // Health check
// app.get('/api/health', async (req, res) => {
//   try {
//     // Test token generation
//     const accessToken = await getGoogleAccessToken();
    
//     res.json({
//       status: 'healthy',
//       timestamp: new Date().toISOString(),
//       tokenSystem: {
//         status: 'working',
//         hasValidToken: !!accessToken,
//         tokenExpiresAt: new Date(tokenCache.expiresAt).toISOString(),
//         autoRefreshEnabled: true
//       },
//       config: {
//         hasGoogleCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
//         hasLindyWebhook: !!LINDY_WEBHOOK_URL,
//         customerId: GOOGLE_ADS_CUSTOMER_ID,
//         port: PORT
//       },
//       note: 'Using auto-refreshing Google OAuth tokens'
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       status: 'error',
//       error: error.message,
//       tokenSystem: {
//         status: 'failed',
//         error: error.message
//       }
//     });
//   }
// });

// // API documentation
// app.get('/api', (req, res) => {
//   res.json({
//     message: 'LSA Message Retrieval API - Auto-Refreshing Tokens',
//     version: '4.0.0',
//     features: [
//       'Auto-generating Google access tokens',
//       'Automatic token refresh on expiry',
//       'No manual token management needed',
//       'Official Google Ads API implementation'
//     ],
//     endpoints: {
//       'GET /api/poll/recent': 'Poll leads from last 5 minutes (for cron job)',
//       'GET /api/leads/last/:minutes': 'Get leads from last N minutes (1-43200 for 30 days)',
//       'GET /api/token-status': 'Check current token status and expiry',
//       'GET /api/health': 'Check system health and token system'
//     },
//     examples: {
//       'Poll recent for cron': `GET ${req.protocol}://${req.get('host')}/api/poll/recent`,
//       'Get last 30 minutes': `GET ${req.protocol}://${req.get('host')}/api/leads/last/30`,
//       'Check token status': `GET ${req.protocol}://${req.get('host')}/api/token-status`
//     },
//     tokenManagement: {
//       system: 'Auto-refreshing OAuth2',
//       provider: 'Google OAuth2 API',
//       refreshBuffer: '60 seconds before expiry',
//       caching: 'In-memory with expiry tracking'
//     }
//   });
// });

// // **CRON JOB: Auto-poll every 5 minutes**
// if (process.env.NODE_ENV !== 'test') {
//   cron.schedule('*/5 * * * *', async () => {
//     console.log('🕐 Automated 5-minute polling triggered...');
//     try {
//       const result = await pollLeadsLastMinutes(250);
//       console.log(`⏰ Cron result: ${result.processedCount} processed, ${result.sentCount} sent`);
//     } catch (error) {
//       console.error('❌ Cron job failed:', error.message);
//     }
//   });
  
//   console.log('⏰ Cron job scheduled: Every 5 minutes');
// }

// app.listen(PORT, () => {
//   console.log(`🚀 LSA Message Retrieval Server running on http://localhost:${PORT}`);
//   console.log(`📊 Customer ID: ${GOOGLE_ADS_CUSTOMER_ID}`);
//   console.log(`🔗 Lindy Webhook: ${LINDY_WEBHOOK_URL ? 'Configured ✅' : 'Not configured ❌'}`);
//   console.log(`🔑 Token System: Auto-refreshing OAuth2 ✅`);
//   console.log(`\n📋 API Endpoints:`);
//   console.log(`   GET  http://localhost:${PORT}/api/poll/recent`);
//   console.log(`   GET  http://localhost:${PORT}/api/leads/last/30`);
//   console.log(`   GET  http://localhost:${PORT}/api/token-status`);
//   console.log(`\n✅ Automatic token refresh system enabled`);
// });

// module.exports = app;

// require('dotenv').config();
// const express = require('express');
// const axios = require('axios');
// const path = require('path');
// const fs = require('fs').promises;
// const cron = require('node-cron');
// const qs = require('querystring');

// const app = express();
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// const PORT = process.env.PORT || 3000;

// // ===== ENVIRONMENT VARIABLES =====
// const {
//   GOOGLE_CLIENT_ID,
//   GOOGLE_CLIENT_SECRET,
//   GOOGLE_REFRESH_TOKEN,
//   GOOGLE_ADS_DEVELOPER_TOKEN,
//   GOOGLE_ADS_CUSTOMER_ID,
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID,
//   LINDY_WEBHOOK_URL,
//   // NEW DYNAMIC VARIABLES
//   POLL_INTERVAL_MINUTES = 5,        // How often to run cron (default: 5 minutes)
//   POLL_BACK_MINUTES = 250,          // How far back to fetch leads (default: 250 minutes)
//   ADD_PHONE_LEADS = 'false'         // Include phone leads (default: false)
// } = process.env;

// // ===== TOKEN MANAGEMENT SYSTEM =====
// let tokenCache = {
//   accessToken: null,
//   expiresAt: 0
// };

// async function getGoogleAccessToken() {
//   const now = Date.now();
  
//   if (tokenCache.accessToken && now < tokenCache.expiresAt - 60000) {
//     console.log('✅ Using cached access token');
//     return tokenCache.accessToken;
//   }

//   console.log('🔄 Auto-generating new Google access token...');
  
//   if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
//     throw new Error('Missing required Google OAuth credentials in environment variables');
//   }

//   try {
//     const response = await axios.post(
//       'https://oauth2.googleapis.com/token',
//       qs.stringify({
//         client_id: GOOGLE_CLIENT_ID,
//         client_secret: GOOGLE_CLIENT_SECRET,
//         refresh_token: GOOGLE_REFRESH_TOKEN,
//         grant_type: 'refresh_token'
//       }),
//       {
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded'
//         }
//       }
//     );

//     tokenCache.accessToken = response.data.access_token;
//     tokenCache.expiresAt = now + (response.data.expires_in * 1000);
    
//     console.log(`✅ New access token generated successfully`);
//     console.log(`⏰ Token expires in ${response.data.expires_in} seconds`);
    
//     return tokenCache.accessToken;
    
//   } catch (error) {
//     console.error('❌ Failed to generate access token:', error.response?.data || error.message);
//     throw new Error(`Token generation failed: ${error.response?.data?.error_description || error.message}`);
//   }
// }

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


// // **REPLACE YOUR EXISTING fetchLSALeadsLastMinutes FUNCTION WITH THIS**
// async function fetchLSALeadsLastMinutes(minutes) {
//   return await fetchLSALeadsWithActivity(minutes);
// }

// // **ADD THIS NEW FUNCTION**
// async function fetchLSALeadsWithActivity(minutes) {
//   const now = new Date();
//   const cutoffTime = new Date(now.getTime() - minutes * 60 * 1000);
  
//   console.log(`🔍 Fetching LSA leads + activity for last ${minutes} minutes (ADD_PHONE_LEADS=${ADD_PHONE_LEADS})`);
  
//   const accessToken = await getGoogleAccessToken();
//   const headers = {
//     'Authorization': `Bearer ${accessToken}`,
//     'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
//     'Content-Type': 'application/json'
//   };
  
//   if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
//     headers['login-customer-id'] = GOOGLE_ADS_LOGIN_CUSTOMER_ID;
//   }

//   const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
  
//   try {
//     // Step 1: Get recent conversations to identify leads with activity
//     const conversationQuery = `
//       SELECT 
//         local_services_lead_conversation.lead,
//         local_services_lead_conversation.event_date_time
//       FROM local_services_lead_conversation 
//       ORDER BY local_services_lead_conversation.event_date_time DESC
//       LIMIT 1000
//     `;
    
//     const conversationResponse = await axios.post(url, { query: conversationQuery }, { headers });
//     const conversations = conversationResponse.data.results || [];
    
//     // Find leads with recent activity
//     const recentActivityLeads = new Set();
//     conversations.forEach(conv => {
//       const eventTime = new Date(conv.localServicesLeadConversation.eventDateTime);
//       if (eventTime >= cutoffTime) {
//         const leadResourceName = conv.localServicesLeadConversation.lead;
//         const leadId = leadResourceName.split('/').pop();
//         recentActivityLeads.add(leadId);
//       }
//     });
    
//     console.log(`📊 Found ${recentActivityLeads.size} leads with recent conversation activity`);
    
//     // Step 2: Get all leads
//     const leadQuery = `
//       SELECT 
//         local_services_lead.lead_type,
//         local_services_lead.category_id, 
//         local_services_lead.service_id,
//         local_services_lead.contact_details,
//         local_services_lead.lead_status,
//         local_services_lead.creation_date_time,
//         local_services_lead.locale,
//         local_services_lead.lead_charged,
//         local_services_lead.id,
//         local_services_lead.resource_name
//       FROM local_services_lead 
//       ORDER BY local_services_lead.creation_date_time DESC
//       LIMIT 500
//     `;
    
//     const leadResponse = await axios.post(url, { query: leadQuery }, { headers });
//     const allLeads = leadResponse.data.results || [];
    
//     console.log(`📊 Found ${allLeads.length} total leads`);
    
//     // Step 3: Filter leads (new OR with recent activity)
//     const filteredResults = allLeads.filter(result => {
//       const lead = result.localServicesLead;
//       const createdTime = new Date(lead.creationDateTime);
      
//       const isNewLead = createdTime >= cutoffTime;
//       const hasRecentActivity = recentActivityLeads.has(lead.id);
      
//       // Include if newly created OR has recent activity
//       if (isNewLead || hasRecentActivity) {
//         // Apply phone lead filtering
//         const includePhoneLeads = ADD_PHONE_LEADS === 'true';
//         if (lead.leadType === 'PHONE_CALL' && !includePhoneLeads) {
//           console.log(`⏭️ Skipping phone lead ${lead.id} (ADD_PHONE_LEADS=false)`);
//           return false;
//         }
        
//         if (hasRecentActivity && !isNewLead) {
//           console.log(`🔄 Including lead ${lead.id} due to recent conversation activity`);
//         }
        
//         return true;
//       }
      
//       return false;
//     });
    
//     console.log(`🎯 Filtered to ${filteredResults.length} leads (${recentActivityLeads.size} with recent activity, ${allLeads.length - filteredResults.length} excluded)`);
    
//     return {
//       success: true,
//       leads: filteredResults,
//       count: filteredResults.length,
//       totalCount: allLeads.length,
//       recentActivityCount: recentActivityLeads.size,
//       phoneLeadsExcluded: allLeads.length - filteredResults.length
//     };
    
//   } catch (error) {
//     const errorMessage = logGoogleAdsError(error, `while fetching leads with activity for last ${minutes} minutes`);
//     return {
//       success: false,
//       error: errorMessage,
//       leads: [],
//       count: 0
//     };
//   }
// }


// // **FETCH CONVERSATIONS WITH MESSAGE TEXT**
// async function fetchLeadConversations(leadResourceName) {
//   const query = `SELECT local_services_lead_conversation.id, local_services_lead_conversation.conversation_channel, local_services_lead_conversation.participant_type, local_services_lead_conversation.lead, local_services_lead_conversation.event_date_time, local_services_lead_conversation.phone_call_details.call_duration_millis, local_services_lead_conversation.phone_call_details.call_recording_url, local_services_lead_conversation.message_details.text, local_services_lead_conversation.message_details.attachment_urls FROM local_services_lead_conversation WHERE local_services_lead_conversation.lead = '${leadResourceName}'`;

//   const url = `https://googleads.googleapis.com/v21/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
//   const accessToken = await getGoogleAccessToken();
  
//   const headers = {
//     'Authorization': `Bearer ${accessToken}`,
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

// // **TRANSFORM FOR LINDY - INCLUDES MESSAGE FILTERING**
// const transformLeadForLindy = (leadData, conversations = []) => {
//   const lead = leadData.localServicesLead;
  
//   // Get actual message text from conversation
//   const latestConversation = conversations.find(c => 
//     c.localServicesLeadConversation?.participantType === 'CONSUMER'
//   );
//   const actualMessageText = latestConversation?.localServicesLeadConversation?.messageDetails?.text;
  
//   let messageText = actualMessageText || 
//                    (lead.leadType === 'MESSAGE' ? 'Message content not available' : 
//                     lead.leadType === 'PHONE_CALL' ? 'Phone call inquiry' :
//                     `${lead.leadType} inquiry`);

//   const contactDetails = lead.contactDetails || {};

//   // **FORMAT FOR GOHIGHLEVEL UPSERT VIA LINDY**
//   return {
//     // Basic lead info
//     leadId: lead.id,
//     messageText: messageText,
//     leadType: lead.leadType,
//     timestamp: lead.creationDateTime,
    
//     // **GOHIGHLEVEL CONTACT FORMAT** (for Lindy to use directly)
//     ghlContactData: {
//       locationId: process.env.GHL_LOCATION_ID || 'YOUR_LOCATION_ID',
//       firstName: contactDetails.consumerName || 'LSA Lead',
//       lastName: '',
//       email: contactDetails.email || '',
//       phone: contactDetails.phoneNumber || '',
//       tags: ['lsa-lead', 'message-inquiry'],
//       source: 'Google LSA',
//       customFields: [
//         {
//           id: 'LEAD_ID', // Replace with actual custom field ID
//           field_value: lead.id
//         },
//         {
//           id: 'MESSAGE', // Replace with actual custom field ID  
//           field_value: messageText
//         },
//         {
//           id: 'TIMESTAMP', // Replace with actual custom field ID
//           field_value: lead.creationDateTime
//         }
//       ]
//     },
    
//     // Legacy format for backward compatibility
//     contactInfo: {
//       name: contactDetails.consumerName || '',
//       phone: contactDetails.phoneNumber || '',
//       email: contactDetails.email || ''
//     }
//   };
// };

// function logLeadPayloadForDebugging(lead) {
//   console.log('\n🚀 PAYLOAD BEING SENT TO LINDY:');
//   console.log('=====================================');
//   console.log(`Lead ID: ${lead.leadId}`);
//   console.log(`Message: "${lead.messageText}"`);
//   console.log(`Lead Type: ${lead.leadType}`);
//   console.log(`Contact Name: ${lead.ghlContactData.firstName}`);
//   console.log(`Email: ${lead.ghlContactData.email}`);
//   console.log(`Phone: ${lead.ghlContactData.phone}`);
//   console.log(`Location ID: ${lead.ghlContactData.locationId}`);
//   console.log('Custom Fields:');
//   lead.ghlContactData.customFields.forEach((field, index) => {
//     console.log(`  ${index + 1}. ${field.id} = "${field.field_value}"`);
//   });
//   console.log('=====================================\n');
// }

// // **SEND TO LINDY WEBHOOK**
// // async function sendToLindy(payload) {
// //   if (!LINDY_WEBHOOK_URL) {
// //     console.warn('⚠️ Lindy webhook URL not configured');
// //     return { success: false, error: 'Webhook URL not configured' };
// //   }

// //   try {
// //     const response = await axios.post(LINDY_WEBHOOK_URL, payload, {
// //       headers: {
// //         'Content-Type': 'application/json',
// //         'User-Agent': 'LSA-GHL-Integration/1.0'
// //       },
// //       timeout: 10000
// //     });
    
// //     console.log(`✅ Sent lead ${payload.leadId} to Lindy: ${response.status}`);
// //     return { 
// //       success: true, 
// //       leadId: payload.leadId,
// //       status: response.status
// //     };
    
// //   } catch (error) {
// //     console.error(`❌ Failed to send lead ${payload.leadId} to Lindy:`, error.message);
// //     return { 
// //       success: false, 
// //       leadId: payload.leadId,
// //       error: error.message
// //     };
// //   }

  
// // }
// async function sendToLindy(payload) {
//   if (!LINDY_WEBHOOK_URL) {
//     console.warn('⚠️ Lindy webhook URL not configured');
//     return { success: false, error: 'Webhook URL not configured' };
//   }

//   // 🚀 ADD THIS LINE
//   logLeadPayloadForDebugging(payload);

//   try {
//     const response = await axios.post(LINDY_WEBHOOK_URL, payload, {
//       headers: {
//         'Content-Type': 'application/json',
//         'User-Agent': 'LSA-GHL-Integration/1.0'
//       },
//       timeout: 10000
//     });
    
//     console.log(`✅ Sent lead ${payload.leadId} to Lindy: ${response.status}`);
//     return { 
//       success: true, 
//       leadId: payload.leadId,
//       status: response.status
//     };
    
//   } catch (error) {
//     console.error(`❌ Failed to send lead ${payload.leadId} to Lindy:`, error.message);
//     return { 
//       success: false, 
//       leadId: payload.leadId,
//       error: error.message
//     };
//   }
// }

// // **MAIN POLLING FUNCTION**
// async function pollLeadsAndSendToLindy() {
//   console.log(`\n🔄 Starting LSA polling for last ${POLL_BACK_MINUTES} minutes...`);
  
//   const leadsResult = await fetchLSALeadsLastMinutes(POLL_BACK_MINUTES);
  
//   if (!leadsResult.success) {
//     console.error(`❌ Failed to fetch leads: ${leadsResult.error}`);
//     return;
//   }
  
//   if (leadsResult.count === 0) {
//     console.log(`📭 No leads found in last ${POLL_BACK_MINUTES} minutes`);
//     return;
//   }
  
//   console.log(`📬 Processing ${leadsResult.count} leads...`);
  
//   const processedLeads = [];
  
//   // Process each lead
//   for (const leadData of leadsResult.leads) {
//     const lead = leadData.localServicesLead;
//     console.log(`🔍 Processing lead ${lead.id} (${lead.leadType})`);
    
//     // Fetch conversations for MESSAGE type leads to get actual message text
//     let conversations = [];
//     if (lead.leadType === 'MESSAGE') {
//       conversations = await fetchLeadConversations(lead.resourceName);
//       console.log(`💬 Found ${conversations.length} conversations for lead ${lead.id}`);
//     }
    
//     // Transform for Lindy
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
// }

// // ===== API ENDPOINTS =====

// // Manual trigger endpoint
// app.get('/api/poll-now', async (req, res) => {
//   try {
//     await pollLeadsAndSendToLindy();
//     res.json({
//       success: true,
//       message: 'Manual polling completed',
//       timestamp: new Date().toISOString()
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// // Get leads for last N minutes (for testing)
// app.get('/api/leads/last/:minutes', async (req, res) => {
//   const minutes = parseInt(req.params.minutes) || 5;
  
//   if (minutes < 1 || minutes > 43200) {
//     return res.status(400).json({
//       success: false,
//       error: 'Minutes must be between 1 and 43200 (30 days)'
//     });
//   }
  
//   try {
//     const leadsResult = await fetchLSALeadsLastMinutes(minutes);
    
//     if (!leadsResult.success) {
//       return res.status(500).json(leadsResult);
//     }
    
//     // Process leads for response
//     const processedLeads = [];
    
//     for (const leadData of leadsResult.leads) {
//       const lead = leadData.localServicesLead;
      
//       let conversations = [];
//       if (lead.leadType === 'MESSAGE') {
//         conversations = await fetchLeadConversations(lead.resourceName);
//       }
      
//       const transformedLead = transformLeadForLindy(leadData, conversations);
//       processedLeads.push(transformedLead);
//     }
    
//     res.json({
//       success: true,
//       leads: processedLeads,
//       count: processedLeads.length,
//       totalCount: leadsResult.totalCount,
//       phoneLeadsExcluded: leadsResult.phoneLeadsExcluded,
//       config: {
//         addPhoneLeads: ADD_PHONE_LEADS === 'true',
//         pollBackMinutes: POLL_BACK_MINUTES,
//         pollInterval: POLL_INTERVAL_MINUTES
//       },
//       timestamp: new Date().toISOString()
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// // Health check
// app.get('/api/health', async (req, res) => {
//   try {
//     const accessToken = await getGoogleAccessToken();
    
//     res.json({
//       status: 'healthy',
//       timestamp: new Date().toISOString(),
//       config: {
//         pollIntervalMinutes: POLL_INTERVAL_MINUTES,
//         pollBackMinutes: POLL_BACK_MINUTES,
//         addPhoneLeads: ADD_PHONE_LEADS === 'true',
//         hasGoogleCredentials: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN),
//         hasLindyWebhook: !!LINDY_WEBHOOK_URL,
//         customerId: GOOGLE_ADS_CUSTOMER_ID
//       },
//       tokenSystem: {
//         status: 'working',
//         hasValidToken: !!accessToken,
//         tokenExpiresAt: new Date(tokenCache.expiresAt).toISOString(),
//         autoRefreshEnabled: true
//       }
//     });
    
//   } catch (error) {
//     res.status(500).json({
//       status: 'error',
//       error: error.message
//     });
//   }
// });

// // **DYNAMIC CRON JOB**
// if (process.env.NODE_ENV !== 'test') {
//   cron.schedule(`*/${POLL_INTERVAL_MINUTES} * * * *`, async () => {
//     console.log(`🕐 Automated ${POLL_INTERVAL_MINUTES}-minute polling triggered...`);
//     try {
//       await pollLeadsAndSendToLindy();
//     } catch (error) {
//       console.error('❌ Cron job failed:', error.message);
//     }
//   });
  
//   console.log(`⏰ Cron job scheduled: Every ${POLL_INTERVAL_MINUTES} minutes`);
// }

// app.listen(PORT, () => {
//   console.log(`🚀 LSA-to-GHL Integration Server running on http://localhost:${PORT}`);
//   console.log(`📊 Customer ID: ${GOOGLE_ADS_CUSTOMER_ID}`);
//   console.log(`🔗 Lindy Webhook: ${LINDY_WEBHOOK_URL ? 'Configured ✅' : 'Not configured ❌'}`);
//   console.log(`⚙️ Config: Poll every ${POLL_INTERVAL_MINUTES}min, fetch last ${POLL_BACK_MINUTES}min, phone leads: ${ADD_PHONE_LEADS}`);
//   console.log(`\n📋 API Endpoints:`);
//   console.log(`   GET  http://localhost:${PORT}/api/health`);
//   console.log(`   GET  http://localhost:${PORT}/api/poll-now`);
//   console.log(`   GET  http://localhost:${PORT}/api/leads/last/60`);
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
