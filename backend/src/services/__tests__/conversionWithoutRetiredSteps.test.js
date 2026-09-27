const fs=require('fs');
const path=require('path');
const {AppError}=require('../../utils/errors');
// Execute the registered handler with isolated dependencies.
function harness(category='trader',denied=false) {
  const source=fs.readFileSync(path.join(__dirname,'../../routes/index.js'),'utf8');
  const start=source.indexOf("router.post('/leads/:id/workflow/conversion',");
  const end=source.indexOf('\n}));',start)+5;
  let handler;
  const client={query:jest.fn(async()=>({rows:[{id:'conversion'}]}))};
  const access=jest.fn(async()=>{if(denied)throw new AppError(403,'FORBIDDEN','Denied');return {category};});
  const observeRemark=jest.fn(async()=>{});
  const run=new Function('router','authenticate','asyncHandler','assertLeadCommunicationAccess','AppError','withTransaction','cancelLeadActiveAttemptSequences','lifecycleService','require',source.slice(start,end));
  run({post:(_path,_auth,fn)=>{handler=fn;}},()=>{},fn=>fn,access,AppError,fn=>fn(client),async()=>{},
    {syncLegacyRemark:async()=>{}},name=>name.includes('auditLog')?{logActivity:async()=>{}}:{observeRemark});
  return {client,observeRemark,save:body=>handler({params:{id:'lead'},user:{id:'owner'},body},{json:jest.fn()})};
}
test('conversion saves without retired step records and upserts completion',async()=>{
  const h=harness();await h.save({});
  const workflowWrite=h.client.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO lead_workflow (lead_id, user_id, conversion_completed'));
  expect(workflowWrite[1]).toEqual(['lead','owner']);
  expect(h.client.query.mock.calls.some(([sql])=>sql.includes('followup_completed'))).toBe(false);
  expect(h.observeRemark).toHaveBeenCalled();
});
test('conversion retains access, category and payment guards',async()=>{
  for(const [h,body,code] of [[harness('trader',true),{},'FORBIDDEN'],[harness('unknown'),{},'INVALID_LEAD_CATEGORY'],
    [harness(),{total_payment:100},'TRANSACTION_ID_REQUIRED'],[harness(),{transaction_id:'bad id'},'INVALID_TRANSACTION_ID']]){
    await expect(h.save(body)).rejects.toMatchObject({code});expect(h.client.query).not.toHaveBeenCalled();
  }
});
