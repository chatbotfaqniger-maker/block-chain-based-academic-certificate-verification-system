import test from "node:test";
import assert from "node:assert/strict";
import {MAX_CAMPAIGN_ITEMS,PROCESSING_BATCH_SIZE,getIssuanceChunk} from "../src/issuance-campaign.js";

test("campaign chunks keep the durable worker unit at 500 without limiting campaign size",()=>{
  const items=Array.from({length:501},(_,i)=>i);
  const first=getIssuanceChunk(items,0);
  const second=getIssuanceChunk(items,500);
  assert.equal(first.items.length,500);
  assert.equal(first.partNumber,1);
  assert.equal(first.totalParts,2);
  assert.equal(second.items.length,1);
  assert.equal(second.start,500);
  assert.equal(second.items[0],500);
  assert.equal(PROCESSING_BATCH_SIZE,500);
});

test("campaign planner handles exact and multi-chunk boundaries",()=>{
  for(const size of [1,499,500,1000,1001,10000,50000]){
    const items=Array.from({length:size},(_,i)=>i);
    let offset=0,total=0,parts=0;
    while(offset<size){
      const chunk=getIssuanceChunk(items,offset);
      assert.ok(chunk.items.length>0&&chunk.items.length<=500);
      assert.equal(chunk.start,offset);
      total+=chunk.items.length;
      offset=chunk.end;
      parts++;
    }
    assert.equal(total,size);
    assert.equal(parts,Math.ceil(size/500));
  }
  assert.equal(MAX_CAMPAIGN_ITEMS,50000);
});

test("campaign planner rejects out-of-range campaign sizes and offsets",()=>{
  assert.throws(()=>getIssuanceChunk(new Array(50001),0),/50,000/);
  assert.throws(()=>getIssuanceChunk([1,2],2),/offset/);
  assert.throws(()=>getIssuanceChunk([1,2],-1),/offset/);
});
