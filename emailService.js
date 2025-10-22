const nodemailer = require('nodemailer');
require('dotenv').config();

// SMTP Configuration
const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.GMAIL_EMAIL,
        pass: process.env.GMAIL_PASS,
    },
});

// Send stuck lead alert
async function sendStuckLeadAlert(stuckLeads) {
    try {
        const leadsSummary = stuckLeads.map(lead => `
            <div style="background: #fff3cd; padding: 15px; margin: 10px 0; border-left: 4px solid #ffc107; border-radius: 5px;">
                <p><strong>🚨 Lead ID:</strong> ${lead.leadId}</p>
                <p><strong>Customer:</strong> ${lead.contactInfo.name || 'Unknown'}</p>
                <p><strong>Phone:</strong> ${lead.contactInfo.phone || 'N/A'}</p>
                <p><strong>⏰ Waiting Time:</strong> <span style="color: #dc3545; font-weight: bold; font-size: 16px;">${lead.minutesSinceLastMessage} minutes</span></p>
                <p><strong>Last Message:</strong> "${lead.messageText.substring(0, 100)}..."</p>
                <p><strong>Last Activity:</strong> ${new Date(lead.timing.lastActivityDateTime).toLocaleString('en-US', { timeZone: 'America/New_York' })} EDT</p>
            </div>
        `).join('');

        const mailOptions = {
            from: `"LSA Lindy Monitor" <${process.env.GMAIL_EMAIL}>`,
            to: process.env.NOTIFICATION_EMAIL,
            subject: `🚨 Lindy Alert: ${stuckLeads.length} Lead(s) Stuck - No Response >10 Minutes`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 700px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
                        .header { background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0; }
                        .content { background-color: #fff; padding: 30px; border: 1px solid #ddd; border-radius: 0 0 10px 10px; }
                        .alert-box { background: #fff3cd; border: 3px solid #ffc107; padding: 25px; margin: 20px 0; border-radius: 10px; text-align: center; }
                        .action-box { background-color: #e7f3ff; border-left: 5px solid #2196F3; padding: 20px; margin: 20px 0; }
                        .stats { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; }
                        .footer { text-align: center; margin-top: 20px; padding-top: 20px; border-top: 2px solid #ddd; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1 style="margin: 0;">🚨 LINDY WORKFLOW ALERT</h1>
                            <p style="margin: 10px 0 0 0;">Customer Response Monitoring System</p>
                        </div>
                        <div class="content">
                            <div class="alert-box">
                                <h2 style="margin: 0 0 15px 0; color: #856404;">${stuckLeads.length} Lead(s) Need Attention</h2>
                                <p style="margin: 0; font-size: 16px;">These leads have been waiting <strong>10+ minutes</strong> without a response from Lindy AI.</p>
                            </div>
                            
                            <h3 style="color: #dc3545;">📋 Stuck Lead Details:</h3>
                            ${leadsSummary}
                            
                            <div class="action-box">
                                <h3 style="margin-top: 0; color: #2196F3;">🔧 ACTIONS REQUIRED:</h3>
                                <ol style="margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                                    <li><strong>Check Lindy Dashboard</strong> - Look for stuck or failed workflows</li>
                                    <li><strong>Review Webhook Logs</strong> - Check for errors or timeouts</li>
                                    <li><strong>Verify Connectivity</strong> - Test webhook endpoint is responding</li>
                                    <li><strong>Check Google LSA API</strong> - Ensure messages are being received</li>
                                    <li><strong>Manual Response</strong> - Contact customer directly if needed</li>
                                </ol>
                            </div>
                            
                            <div class="stats">
                                <h4 style="margin: 0 0 10px 0;">📊 Alert Information:</h4>
                                <p style="margin: 5px 0;"><strong>Detection Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EDT</p>
                                <p style="margin: 5px 0;"><strong>Affected Leads:</strong> ${stuckLeads.length}</p>
                                <p style="margin: 5px 0;"><strong>Threshold:</strong> 10 minutes</p>
                            </div>
                            
                            <p style="margin-top: 30px; padding: 15px; background: #e8f5e9; border-radius: 5px; border-left: 4px solid #4caf50;">
                                <strong>💡 Note:</strong> This is a notification only. Please investigate and take appropriate action.
                            </p>
                        </div>
                        <div class="footer">
                            <p><strong>🤖 LSA-to-Lindy Integration System</strong></p>
                            <p>Automated monitoring runs every 10 minutes</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Alert email sent successfully:`, info.messageId);
        return {
            statusCode: 200,
            message: "Alert email sent successfully",
            messageId: info.messageId
        };
    } catch (error) {
        console.error('❌ Failed to send alert email:', error.message);
        return {
            statusCode: 500,
            message: `Failed to send alert: ${error.message}`
        };
    }
}

module.exports = { 
    sendStuckLeadAlert
};
