const {journeyDeadlines,newAssignmentDeadlines,RETRYABLE_ISSUES,NR_STATUSES,CALL_ISSUE_STATUSES,CLOCKS}=require('./counselorWorkflowPolicies');
const {STATUS_VALUES}=require('./counselorWorkflowService');
const {CALL_ISSUE_LABELS}=require('../constants/counselorReportOptions');

const names={
  communication_completed:['CC','Communication Completed','You have completed communication with the lead.'],
  respond_hi:['R','Responded','The lead has responded; the next action is still needed.'],
  common_meeting:['CM','Common Meeting','The lead is in the common-meeting journey.'],
  dim:['DIM','Discussed in Meeting','A discussion in the meeting has been recorded.'],
  personal_meeting:['PM','Personal Meeting','The lead is in the personal-meeting journey.'],
  follow_up:['FLP','Follow-Up','Further contact with the lead is needed.'],
  quotation:['Q','Quotation','The lead is in the quotation journey.'],
  hot:['Hot','Hot','A lead marked as high interest.'],warm:['Warm','Warm','An interested lead that needs further follow-up.'],
  process_incomplete:['PI','Process Incomplete','The lead’s process still needs to be completed.'],
  special_category:['SC','Special Category','A lead placed in a special category.'],
  call_reminder:['CR','Call Reminder','A reminder category; schedule a follow-up when a specific time is needed.'],
  handover_rm:['RM','Handover to RM','A handover category. This remark alone does not reassign the lead.'],
  not_attended:['NT','Not Attended','Attendance has been marked as not attended.'],
  converted:['Converted','Converted','The counselor journey is marked converted.'],
  cold:['Cold','Cold','The counselor journey is marked cold.'],
  cnr:['CNR','Call Not Received','The call was not received.'],
  switched_off:['Switch Off','Switch Off','The phone is switched off.'],
  ccb:['CCB','CCB','An existing call-status category. It has no automatic aging rule.'],
  talk_response:['Connected','Connected','A connected conversation was recorded.'],
  session_730_attend:['Meeting attended','Common Meeting Attended','Attendance was recorded. This is separate from the Common Meeting journey.'],
  yes_after_730_session:['Yes after meeting','Yes After Common Meeting','A positive response after the common meeting.'],
  custom_remark:['Remark','Custom Remark','A free-text remark category.'],
};
const title=value=>value.split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');
const hours=(a,b)=>(new Date(a)-new Date(b))/3600000;
const duration=value=>`${value} ${value===1?'hour':'hours'}`;
const timeLabel=value=>{const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;};

function guide() {
  // Exercise the authoritative calculator; do not maintain another duration map.
  const start=new Date(`2030-09-26T${CLOCKS.opening}:00+05:30`);
  const office=`From ${timeLabel(CLOCKS.opening)} through ${timeLabel(CLOCKS.closing)}, including both exact boundaries`;
  const outside=`Before ${timeLabel(CLOCKS.opening)}: ${timeLabel(CLOCKS.overnight)} the same day. After ${timeLabel(CLOCKS.closing)}: ${timeLabel(CLOCKS.overnight)} the next day.`;
  const cards=[...STATUS_VALUES].map(status=>{
    const policy=journeyDeadlines(status,start);
    const nr=NR_STATUSES.includes(status);
    const category=nr?'Not Responding':CALL_ISSUE_STATUSES.includes(status)?'Call Issues':policy?'Journey':'Special';
    const [code,label,meaning]=names[status] || (nr?[status.toUpperCase(),`Not Responding (${status.toUpperCase()})`,'A not-responding category; use the code matching the lead’s recorded context.']:
      [status.length<=3?status.toUpperCase():title(status),CALL_ISSUE_LABELS[status]||title(status),CALL_ISSUE_STATUSES.includes(status)?'A contact issue recorded for this lead.':'An additional remark category supported by the CRM.']);
    const firstHours=policy?hours(policy.move_to_old_at,start):null;
    const secondHours=policy?hours(policy.move_to_pending_at,policy.move_to_old_at):null;
    const first=status==='respond_hi'?`At ${timeLabel(CLOCKS.responded)} today when saved before or exactly at that time; otherwise at ${timeLabel(CLOCKS.responded)} tomorrow.`:
      nr?`${office}: ${duration(firstHours)} after the remark. ${outside}`:
        policy?`${duration(firstHours)} after the remark.`:'No automatic Old/Pending timer';
    return {status,code,label,meaning,category,automaticAging:Boolean(policy),firstHours:status==='respond_hi'?null:firstHours,secondHours,
      first,second:policy?`${duration(secondHours)} more after entering Old.`:'No automatic Old/Pending timer',
      steps:policy?[label,`${label} + Old Leads`,'Pending']:[label],
      special:status==='respond_hi'?`All times are Asia/Kolkata. Exactly ${timeLabel(CLOCKS.responded)} uses the same-day cutoff.`:
        nr?'The daytime delay can extend beyond office hours. There is no weekend or holiday exception.':
          RETRYABLE_ISSUES.includes(status)?'This waiting period applies around the clock.':
            !policy?'Keep this category until further action; adding a new primary remark may start its own rule.':null};
  });
  const newHours=hours(newAssignmentDeadlines(start).move_to_pending_at,start);
  cards.push({status:'new',code:'New',label:'New Leads — untouched',meaning:'A newly assigned lead with no counselor remark.',category:'Queues',automaticAging:true,firstHours:newHours,secondHours:null,
    first:`${office}: ${duration(newHours)} after assignment. ${outside}`,second:'Pending directly. Untouched New never enters Old and does not count as Worked.',
    steps:['New','No work','Pending'],special:'The daytime delay is not shortened at closing time. No weekend or holiday exception.'});
  return {timezone:'Asia/Kolkata',cards};
}
module.exports={guide};
