
// In-memory store
let callData = {};

// Compute next action
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
    slot = ""
  } = body;

  let phase;
  let instruction;
  let warnings = ["Be SILENT during any tool calls. No filler phrases."];

  const hasName = firstName && lastName;
  const hasPhone = phone && phone.length >= 10;
  const hasEmail = email && email.includes("@");
  const hasSlot = slot && slot !== "No appointment scheduled";

  let isQualified = false;
  if (category === "Estate Planning") {
    isQualified = age55 && assets;
  } else if (category === "Probate") {
    isQualified = ncConfirmed && estateValue !== "";
  }

  if (!category) {
    phase = "CATEGORIZE";
    instruction = "Listen to the caller's description. Set category to 'Probate' if about death/inheritance, or 'Estate Planning' if about future planning/will.";
  } else if (!isQualified) {
    phase = "QUALIFY";
    instruction = `Ask missing qualification questions for ${category} one by one:`;

    if (category === "Estate Planning") {
      if (!age55) instruction = "Ask: 'Are you 55 years or older?' (set age55=true if yes)";
      else if (!assets) instruction = "Ask: 'Do you own property or real estate worth over $200,000 OR have savings/investments worth more than $100,000 you'd like to protect?' (set assets=true if yes)";
      warnings.push("No condolences for Estate Planning.");
    } else if (category === "Probate") {
      if (!ncConfirmed) {
        instruction = "Ask: 'Did the person who died reside in NC or have real estate there?' (set ncConfirmed=true if yes) If ncConfirmed=false, disqualify Probate and Say: 'I'm sorry — we're only licensed for North Carolina probate cases. I wish I could help, but we're not the right fit.' Then ask: 'Do you have any other questions I can help with?' If no, say 'Best of luck. Take care.' and call end_call. If yes, answer briefly, then ask again 'Anything else?' and repeat until no."
        warnings.push("Say 'I'm sorry for your loss' ONLY if not said before.");
      } else if (estateValue === "") {
        instruction = "Ask: 'Do you know the estimated value of the estate, including real estate?' (set estateValue to answer)";
        return { phase, instruction, warnings, collected: {} };
      }
    }

  } else if (!hasName) {
    phase = "COLLECT_NAME";
    instruction = "Ask: 'What's your first and last name?' Read back the name letter-by-letter.";
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
      ? "Ask permission, then call calendarFetchProbate. Present 2–3 slots/day, max 3 days: 'Slots today at [1], [2], [3], tomorrow at [1], [2], and more this week. When works?' If user selects slot, set collected_slot to ISO."
      : "Ask permission, then call calendarFetchEstate. Present 2–3 slots/day, max 3 days: 'Slots today at [1], [2], [3], tomorrow at [1], [2], and more this week. When works?' If user selects slot, set collected_slot to ISO.";
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


module.exports = { computeNextAction }; // Ensure it's exported as an object