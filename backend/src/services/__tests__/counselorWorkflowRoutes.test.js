jest.mock('../../config/database',()=>({query:jest.fn(),withTransaction:jest.fn()}));
jest.mock('../../utils/logger',()=>({warn:jest.fn(),info:jest.fn(),error:jest.fn()}));
jest.mock('../../middleware/auth',()=>({authenticate:(req,res,next)=>{
  if(!req.headers['x-test-role']) return res.status(401).json({success:false});
  req.user={id:'test-user',role:req.headers['x-test-role']}; next();
}}));
jest.mock('../counselorWorkflowService',()=>({configuration:jest.fn(()=>({enabled:false})),
  workspace:jest.fn(async()=>({enabled:false,rows:[],total:0})),read:jest.fn(async()=>({enabled:false,state:null,events:[]})),
  recordRemark:jest.fn(async()=>({duplicate:false}))}));
jest.mock('../counselorGuideService',()=>({guide:()=>({timezone:'Asia/Kolkata',cards:[]})}));
const express=require('express');
const request=require('supertest');
const service=require('../counselorWorkflowService');
const app=express();
app.use(express.json());app.use(require('../../routes/lifecycle'));
app.use((err,req,res,next)=>res.status(err.status||500).json({success:false,code:err.code}));
test('configuration requires authentication',async()=>{expect((await request(app).get('/counselor-workflow/v1/config')).status).toBe(401);});
test('CRM Guide requires authentication',async()=>{expect((await request(app).get('/counselor-workflow/v1/guide')).status).toBe(401);});
test.each(['admin','rm','super_admin','client'])('versioned endpoints do not grant %s access',async role=>{
  for(const suffix of ['config','guide','leads','leads/id']) expect((await request(app).get(`/counselor-workflow/v1/${suffix}`).set('x-test-role',role)).status).toBe(403);
  expect((await request(app).post('/counselor-workflow/v1/leads/id/remarks').set('x-test-role',role).send({})).status).toBe(403);
});
test.each(['member','partner'])('%s receives backward-compatible envelope when disabled',async role=>{
  expect((await request(app).get('/counselor-workflow/v1/guide').set('x-test-role',role)).body).toEqual({success:true,data:{timezone:'Asia/Kolkata',cards:[],enabled:false}});
  const result=await request(app).get('/counselor-workflow/v1/leads').set('x-test-role',role);
  expect(result.body).toEqual({success:true,data:{enabled:false,rows:[],total:0}});
});
test('remark route forwards explicit primary and returns idempotent retry status',async()=>{
  const body={primary_status:'cnr',statuses:['cnr'],expected_generation:2,idempotency_key:'retry-key'};
  expect((await request(app).post('/counselor-workflow/v1/leads/id/remarks').set('x-test-role','member').send(body)).status).toBe(201);
  expect(service.recordRemark).toHaveBeenLastCalledWith({id:'test-user',role:'member'},'id',body);
  service.recordRemark.mockResolvedValueOnce({duplicate:true});
  expect((await request(app).post('/counselor-workflow/v1/leads/id/remarks').set('x-test-role','member').send(body)).status).toBe(200);
});
