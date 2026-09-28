const {workSource}=require('../counselorWorkSource');
test.each([['new','new'],['old','old'],['pending','old'],[null,null],['',null],['unknown',null]])('queue %s maps to %s',(queue,expected)=>{
  expect(workSource(queue)).toBe(expected);
});
