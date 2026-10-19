/** Free-ride budgets: distant geometry is cheap; wheel-scale terrain stays detailed nearby. */
export function renderPolicy(quality=1){
 const high=quality>.7,low=quality<.5;
 return {
  resolution:high?192:low?96:128,chunkSegments:16,scenery:Math.round(1700*quality),
  half:low?48:64,segments:high?128:low?48:64,stride:16,
  patchVerticesPerFrame:2048,patchBudgetMs:1.5,
 };
}
