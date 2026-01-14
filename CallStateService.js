/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  CALL STATE SERVICE - Manages call flow and state for VAPI/AI calls          ║
 * ║  Version: 1.0.0                                                               ║
 * ║  Tracks call progression through qualification and booking phases             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

const express = require('express');

// In-memory store for call data
let callData = {};

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  COMPUTE NEXT ACTION FUNCTION                                                 ║
 * ║  Determines the next phase and instructions for the AI agent                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
function computeNextAction(body) {
  const {
    category = "",
    ncConfirmed = false,
    estateValue = "",
    age55 = false,
    assets = false,
    firstName = "",
    lastName = "",
    phone = "",
    email = "",
    slot = "",
    ncAsked = false  // NEW: Track if NC question was asked
  } = body;

  let phase;
  let instruction;
  let warnings = ["Be SILENT during any tool calls. No filler phrases."];

  const hasName = firstName && lastName;
  const hasPhone = phone && phone.length >= 10;
  const hasEmail = email && (email.includes("@") || email === "No email - will contact by phone");
  const hasSlot = slot && slot !== "No appointment scheduled";

  let isQualified = false;
  if (category === "Estate Planning") {
    isQualified = age55 && assets;
  } else if (category === "Probate") {
    isQualified = ncConfirmed && estateValue && estateValue !== "";
  }

  // State machine
  if (!category) {
    phase = "CATEGORIZE";
    instruction = "Listen to the caller's description. Set category to 'Probate' if about death/inheritance, or 'Estate Planning' if about future planning/will.";
  } else if (!isQualified) {
    phase = "QUALIFY";
    instruction = `Ask ONE missing qualification question for ${category}:`;

    if (category === "Estate Planning") {
      if (!age55) instruction = "Ask: 'Are you 55 years or older?' (set age55=true if yes)";
      else if (!assets) instruction = "Ask: 'Do you own property or real estate worth over $200,000 OR have savings/investments worth more than $100,000 you'd like to protect?' (set assets=true if yes)";
      warnings.push("No condolences for Estate Planning.");
    } else if (category === "Probate") {
      if (!ncConfirmed && !ncAsked) {
        instruction = "Ask: 'Did the person who died reside in NC or have real estate there?' (set ncAsked=true, set ncConfirmed=true if yes)";
        warnings.push("Say 'I'm sorry for your loss' ONLY if not said before.");
      } else if (estateValue === "") {
        instruction = "Ask: 'Do you know the estimated value of the estate, including real estate?' (set estateValue to answer)";
      } else if (ncAsked && !ncConfirmed) {
        // Disqualification only AFTER asking NC and getting "no"
        phase = "DISQUALIFY";
        instruction = "Say: 'I'm sorry — we're only licensed for North Carolina probate cases. I wish I could help, but we're not the right fit.' Then ask: 'Do you have any other questions I can help with?' If no, say 'Best of luck. Take care.' and call end_call. If yes, answer briefly, then ask again 'Anything else?' and repeat until no.";
        warnings.push("CRITICAL: NC not confirmed — disqualify Probate. No scheduling.");
        return { phase, instruction, warnings, collected: {} };
      }
    }
  } else if (!hasName) {
    phase = "COLLECT_NAME";
    instruction = "Ask: 'What's your first and last name?' Confirm spelling letter-by-letter.";
  } else if (!hasPhone) {
    phase = "COLLECT_PHONE";
    instruction = "Ask: 'What's the best callback number?' Read back digit-by-digit 3-3-4 with pauses.";
    warnings.push("NEVER echo format. Parse shorthand.");
  } else if (!hasEmail) {
    phase = "COLLECT_EMAIL";
    instruction = "Ask: 'What email should we send the Zoom link to?' If decline: 'No problem, we'll reach you by phone.' Spell read-back letter-by-letter.";
  } else if (!hasSlot) {
    phase = "BOOKING";
    instruction = category === "Probate"
      ? "Ask permission, then call calenterFetchProbate. Present 2–3 slots/day, max 3 days: 'Slots today at [1], [2], [3], tomorrow at [1], [2], and more this week. When works?' If user selects slot, set collected_slot to ISO."
      : "Ask permission, then call calenterFetchEstate. Present 2–3 slots/day, max 3 days: 'Slots today at [1], [2], [3], tomorrow at [1], [2], and more this week. When works?' If user selects slot, set collected_slot to ISO.";
    warnings.push("Call calendar ONCE. DO NOT re-ask collected info.");
  } else {
    phase = "CONFIRM";
    instruction = "Call send_booking_to_lindy_workflow (SILENT). Then: 'You're all set for [day of week] [Month Day] at [time].' (use exact day/date/time from collected_slot). Then enter closing loop: ask 'Is there anything else I can help you with today?' and repeat until no.";
  }

  return {
    phase,
    instruction,
    warnings,
    collected: {
      category: !!category,
      qualified: isQualified,
      name: hasName,
      phone: hasPhone,
      email: hasEmail,
      slot: hasSlot
    }
  };
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  UPDATE CALL STATE FUNCTION                                                   ║
 * ║  Updates or creates call state and returns next action                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
function updateCallState(requestBody) {
  const { callId, phone } = requestBody;
  const id = callId || phone || Date.now().toString();

  const result = computeNextAction(requestBody);

  callData[id] = {
    ...(callData[id] || {}),
    ...requestBody,
    phase: result.phase,
    instruction: result.instruction,
    warnings: result.warnings,
    collected: result.collected,
    lastUpdated: new Date().toISOString()
  };

  console.log(`✅ [CALL STATE] Updated state for ${id}:`, callData[id].phase);

  return {
    next_action: result.phase,
    instruction: result.instruction,
    warnings: result.warnings,
    collected: result.collected,
    full_chart: callData[id]
  };
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  GET ALL CALL STATES FUNCTION                                                 ║
 * ║  Returns all stored call data for debugging/monitoring                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
function getAllCallStates() {
  return {
    totalCalls: Object.keys(callData).length,
    calls: callData
  };
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  GET SPECIFIC CALL STATE FUNCTION                                             ║
 * ║  Returns data for a specific call ID                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
function getCallState(callId) {
  return callData[callId] || null;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  CLEAR OLD CALL DATA FUNCTION                                                 ║
 * ║  Removes call data older than specified hours                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
function clearOldCallData(hoursOld = 24) {
  const cutoffTime = Date.now() - (hoursOld * 60 * 60 * 1000);
  let removedCount = 0;

  Object.keys(callData).forEach(id => {
    const lastUpdated = new Date(callData[id].lastUpdated || 0).getTime();
    if (lastUpdated < cutoffTime) {
      delete callData[id];
      removedCount++;
    }
  });

  console.log(`🧹 [CALL STATE] Cleared ${removedCount} old call records (>${hoursOld}h)`);
  return { removedCount, remaining: Object.keys(callData).length };
}

// Export all functions
module.exports = {
  computeNextAction,
  updateCallState,
  getAllCallStates,
  getCallState,
  clearOldCallData
};