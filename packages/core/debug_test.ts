import { OfflineDraftValidator } from "./src/validation/OfflineDraftValidator";
import { ValidPayrollDraft } from "./src/testing/fixtures/drafts/DraftFixtures";

const validator = new OfflineDraftValidator();
const result = validator.validate(ValidPayrollDraft);

console.log("isValid:", result.isValid);
console.log("blockers:", result.blockers);
console.log("warnings:", result.warnings);
console.log("summary:", result.summary);
