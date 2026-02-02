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
    slot = "",
    condolenceGiven = false,
    consultationAgreed = false,
    emailDeclined = false
  } = body;

  let phase;
  let instruction;
  let warnings = ["Be SILENT during any tool calls. No filler phrases."];

  // Convert string booleans to actual booleans
  const actualNcConfirmed = ncConfirmed === true || ncConfirmed === "true";
  const actualAge55 = age55 === true || age55 === "true";
  const actualAssets = assets === true || assets === "true";
  const actualConsultationAgreed = consultationAgreed === true || consultationAgreed === "true";
  const actualEmailDeclined = emailDeclined === true || emailDeclined === "true";

  const hasName = firstName && lastName;
  const hasPhone = phone && phone.length >= 10;
  const hasEmail = email && email.includes("@");
  const hasSlot = slot && slot !== "No appointment scheduled";
  const emailSatisfied = hasEmail || actualEmailDeclined;

  let isQualified = false;

  if (category === "Estate Planning") {
    isQualified = actualAge55 && actualAssets;
  } else if (category === "Probate") {
    isQualified = actualNcConfirmed && estateValue !== "";
  }

  if (actualConsultationAgreed) {
    warnings.push("ALREADY AGREED: User agreed to schedule. DO NOT offer consultation again. Just collect their information.");
  }

  if (!category || category === "") {
    phase = "CATEGORIZE";
    instruction = "Listen to the caller's description. Set category to 'Probate' if about death/inheritance/estate of someone who passed, or 'Estate Planning' if about future planning/will/protecting assets.";
  } else if (!isQualified) {
    phase = "QUALIFY";

    if (category === "Estate Planning") {
      if (!actualAge55) {
        instruction = "Ask: 'Are you 55 years or older?' (set age55=true if yes)";
      } else if (!actualAssets) {
        instruction = "Ask: 'Do you own property or real estate worth over $200,000 OR have savings/investments worth more than $100,000 you'd like to protect?' (set assets=true if yes)";
      }
      warnings.push("No condolences for Estate Planning - this is future planning, not loss.");
    } else if (category === "Probate") {
      if (!condolenceGiven) {
        warnings.push("EMPATHY RULE: Say 'I'm sorry for your loss' ONLY if caller has explicitly mentioned someone passed away/died. 'Probate' alone does NOT mean recent death - could be old estate, helping a friend, etc.");
      }

      if (!actualNcConfirmed) {
        instruction = "Ask: 'Did they reside in North Carolina, or own any property there?' (set ncConfirmed=true if yes to either). If NO to both, disqualify: 'I'm sorry — we're only licensed for North Carolina probate cases. I wish I could help, but we're not the right fit.' Then ask: 'Do you have any other questions I can help with?' If no, say 'Best of luck. Take care.' and call end_call. If yes, answer briefly, then ask again 'Anything else?' and repeat until no.";
      } else if (estateValue === "") {
        instruction = "Ask: 'Do you have a rough idea of the estate's value? Including any real estate and bank accounts?' (set estateValue to their answer - any ballpark is fine)";
      }
    }
  } else if (!hasName) {
    phase = "COLLECT_NAME";
    instruction = "Ask: 'What's your first and last name?' Spell back the LAST NAME only, letter-by-letter. Example: 'Got it, John. That's S-M-I-T-H for the last name?' WAIT FOR CONFIRMATION. If they don't confirm, ask: 'Is that correct?'";
  } else if (!hasPhone) {
    phase = "COLLECT_PHONE";
    instruction = "Ask: 'What's the best number to reach you?' Read back in 3-3-4 format with pauses: 'I have 7 2 5, then 3 3 1, then 2 2 1 1. Is that right?' Parse shorthand: 'double 5' = 55, 'triple 9' = 999, 'oh' = 0. WAIT FOR CONFIRMATION. If they don't confirm, ask: 'Can you confirm that's correct?'";
    warnings.push("CRITICAL: Phone accuracy is essential. ALWAYS read back and confirm. NEVER skip confirmation.");
  } else if (!emailSatisfied) {
    phase = "COLLECT_EMAIL";
    instruction = "Ask: 'What email should we send the appointment reminder to?' If they decline or say 'text me': set emailDeclined=true and say 'No problem, we'll just give you a call.' If they provide email, spell back EVERY letter: 'So that's j-e-f-f-s-m-i-t-h at gmail dot com. Is that right?' WAIT FOR CONFIRMATION. If they don't confirm, ask: 'Is that email correct?'";
    warnings.push("EMAIL: Spell back EVERY letter. Do NOT ask 'is that with a dot?' - just spell what you heard.");
  } else if (!hasSlot) {
    phase = "BOOKING";
    instruction = category === "Probate"
      ? "Call calendarFetchProbate (SILENT). Present 2–3 slots per day, max 3 days. Use day names: 'I have times on Monday at 1 PM and 2:30, or Tuesday at 1 PM. What works best?' NEVER offer Saturday or Sunday."
      : "Call calendarFetchEstate (SILENT). Present 2–3 slots per day, max 3 days. Use day names: 'I have times on Monday at 1 PM and 2:30, or Tuesday at 1 PM. What works best?' NEVER offer Saturday or Sunday.";
    warnings.push("Call calendar tool ONCE. DO NOT re-ask already collected info.");
  } else {
    phase = "CONFIRM";
    instruction = "Call send_booking_to_lindy_workflow (SILENT). Then confirm ALL details: 'You're all set for [day name along with date] at [time]. We'll call you at [phone number]. One of our senior legal advocates will give you a call then.' Then enter closing loop: ask 'Is there anything else I can help you with today?' and repeat until no. When done: 'Alright, have a good day.' and call end_call.";
  }

  return {
    phase,
    instruction,
    warnings,
    collected: {
      category: !!category,
      qualified: isQualified,
      consultationAgreed: actualConsultationAgreed,
      name: hasName,
      phone: hasPhone,
      email: hasEmail,
      emailDeclined: actualEmailDeclined,
      slot: hasSlot
    },
    full_state: {
      category,
      ncConfirmed: actualNcConfirmed,
      estateValue,
      age55: actualAge55,
      assets: actualAssets,
      firstName,
      lastName,
      phone: phone ? `${phone.substring(0,3)}...` : "",
      email: email ? `${email.split('@')[0].substring(0,3)}...@${email.split('@')[1] || ''}` : "",
      slot,
      condolenceGiven,
      consultationAgreed: actualConsultationAgreed,
      emailDeclined: actualEmailDeclined
    }
  };
}
module.exports = { computeNextAction };
