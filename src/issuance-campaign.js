export const MAX_CAMPAIGN_ITEMS=8000;
export const MAX_MONTHLY_ISSUANCE_ITEMS=8000;
export const PROCESSING_BATCH_SIZE=500;
export const MAX_LEGACY_CAMPAIGN_ITEMS=50000;

export function getIssuanceChunk(items,startIndex){
  if(!Array.isArray(items))throw new TypeError("Issuance campaign items must be an array.");
  if(items.length>MAX_LEGACY_CAMPAIGN_ITEMS)throw new RangeError("An issuance campaign cannot exceed 50,000 items, including previously created campaigns.");
  if(!Number.isInteger(startIndex)||startIndex<0||startIndex>=items.length)throw new RangeError("Invalid issuance campaign offset.");
  const start=Math.floor(startIndex/PROCESSING_BATCH_SIZE)*PROCESSING_BATCH_SIZE;
  const end=Math.min(start+PROCESSING_BATCH_SIZE,items.length);
  return {start,end,items:items.slice(start,end),partNumber:Math.floor(start/PROCESSING_BATCH_SIZE)+1,totalParts:Math.ceil(items.length/PROCESSING_BATCH_SIZE)};
}
