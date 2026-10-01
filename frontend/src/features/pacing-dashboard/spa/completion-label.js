export function completionLabel(hasAudio) { return hasAudio ? 'VCR/ACR' : 'VCR'; }
export function completionLabelForLI(plan) {
  return (plan && (plan.ch || '').toLowerCase() === 'audio') ? 'ACR' : 'VCR';
}
