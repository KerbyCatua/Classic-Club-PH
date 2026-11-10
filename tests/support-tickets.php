<?php
declare(strict_types=1);
// Run: C:/xampp/php/php.exe tests/support-tickets.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__.'/../app/Database/Connection.php';
require_once __DIR__.'/../app/Services/SupportTicketService.php';
use ClassicClub\Services\SupportTicketService;
function check(bool $value,string $message): void { if (!$value) throw new RuntimeException($message); }
$service=new SupportTicketService($pdo);
$actor=(int)($service->agents()[0]['id'] ?? 0);
check($actor>0,'An active Super Admin is required.');
$ids=[]; $marker='support-test-'.bin2hex(random_bytes(8)); $businessStaff=0;
$create=['action'=>'create','full_name'=>'Support integration test','email'=>$marker.'@example.com','subject'=>$marker,'message'=>'Original request <script> with unicode ñ','category'=>'Order / checkout','priority'=>'High','assigned_to'=>$actor,'order_number'=>'TEST-123'];
function payload(array $detail,string $action,array $fields=[]): array {
    $t=$detail['ticket']; return ['id'=>$t['id'],'version'=>$t['version'],'updated_at'=>$t['updated_at'],'action'=>$action]+$fields;
}
try {
    $d=$service->mutate($actor,$create); $id=(int)$d['ticket']['id']; $ids[]=$id;
    check($d['ticket']['status']==='open' && (int)$d['ticket']['assigned_to']===$actor,'Create persists inquiry and assignment.');
    $update=payload($d,'update',['subject'=>$marker.' updated','category'=>'Returns','priority'=>'Critical','status'=>'in_progress','assigned_to'=>null,'resolution_summary'=>'']);
    $d=$service->mutate($actor,$update);
    check($d['ticket']['priority']==='Critical' && $d['ticket']['assigned_to']===null,'Metadata persists.');
    try { $service->mutate($actor,$update); throw new LogicException('Expected stale version rejection.'); } catch (RuntimeException $e) { check($e->getCode()===409,'Conflict returns 409.'); }
    $d=$service->mutate($actor,payload($d,'draft',['body'=>'Persistent draft']));
    check($service->detail($id,$actor)['draft']==='Persistent draft','Draft survives reload.');
    $d=$service->mutate($actor,payload($d,'note',['body'=>'Restricted internal note']));
    check($d['entries'][0]['kind']==='note','Internal note is recorded separately.');
    $d=$service->mutate($actor,payload($d,'reply',['body'=>'A saved reply']));
    check($d['draft']==='' && $d['ticket']['first_response_at']!==null && $d['entries'][0]['kind']==='reply','Reply and response timing persist; draft clears.');
    $update=payload($d,'update',['subject'=>$marker,'category'=>'Returns','priority'=>'Critical','status'=>'closed','assigned_to'=>$actor,'resolution_summary'=>'']);
    try { $service->mutate($actor,$update); throw new LogicException('Expected required resolution.'); } catch (InvalidArgumentException) {}
    check($service->detail($id,$actor)['ticket']['status']==='in_progress','Invalid resolution rolls back.');
    $update['resolution_summary']='Issue resolved'; $d=$service->mutate($actor,$update);
    check($d['ticket']['closed_at']!==null && $d['ticket']['resolved_at']!==null,'Closing sets resolution timestamps.');
    $update=payload($d,'update',['subject'=>$marker,'category'=>'Returns','priority'=>'Critical','status'=>'open','assigned_to'=>$actor,'resolution_summary'=>'Reopened']);
    $d=$service->mutate($actor,$update);
    check($d['ticket']['resolved_at']===null && $d['ticket']['closed_at']===null && str_contains(json_encode($d['entries']),'Issue resolved'),'Reopening resets active timers and retains history.');
    check($service->listing(['search'=>$marker,'category'=>'Returns','status'=>'open','priority'=>'Critical','assigned_to'=>$actor])['total']===1,'Combined filters work.');
    check($service->listing(['search'=>'INQ-'.$id])['total']===1,'Reference search works.');
    check($service->listing(['search'=>$marker,'assigned_to'=>'unassigned'])['total']===0,'Unassigned filter works.');
    foreach ([['page'=>-1],['search'=>[]],['status'=>'invalid'],['category'=>['Other']],['assigned_to'=>-1]] as $bad) {
        try { $service->listing($bad); throw new LogicException('Expected invalid filter rejection.'); } catch (InvalidArgumentException) {}
    }
    $update=payload($d,'update',['subject'=>$marker,'category'=>'Returns','priority'=>'Critical','status'=>'open','assigned_to'=>999999999,'resolution_summary'=>'']);
    try { $service->mutate($actor,$update); throw new LogicException('Expected unauthorized assignee rejection.'); } catch (InvalidArgumentException) {}
    try { $service->mutate($actor,payload($d,'attachment'),['error'=>UPLOAD_ERR_OK,'tmp_name'=>__FILE__,'size'=>100,'name'=>'unsafe.php']); throw new LogicException('Expected invalid upload.'); } catch (InvalidArgumentException) {}
    // Existing Contact records appear directly, without importing or duplicating them.
    $q=$pdo->prepare("INSERT INTO contact_inquiries (full_name,email,topic,message) VALUES (?,?,'sizing',?)");
    $q->execute(['Legacy contact',$marker.'@example.com',$marker]); $legacy=(int)$pdo->lastInsertId(); $ids[]=$legacy;
    $old=$service->detail($legacy,$actor); check((int)$old['ticket']['version']===0 && $old['ticket']['category']==='Sizing','Legacy inquiry is immediately manageable.');
    $service->mutate($actor,payload($old,'note',['body'=>'Legacy inquiry note']));
    for ($i=0;$i<21;$i++) { $row=$service->mutate($actor,$create); $ids[]=(int)$row['ticket']['id']; }
    $list=$service->listing(['search'=>$marker,'page'=>2]);
    check($list['total']===23 && count($list['rows'])===3 && $list['pages']===2,'Queue paginates with stable totals.');
    for ($i=0;$i<32;$i++) { $d=$service->detail($id,$actor); $service->mutate($actor,payload($d,'note',['body'=>'History page entry '.$i])); }
    check($service->detail($id,$actor,2)['pages']===2 && count($service->detail($id,$actor,2)['entries'])>0,'Full conversation and history are paginated.');
    // Notify only businesses actually linked to the requester, and never for internal notes.
    $email=$pdo->query('SELECT email FROM users WHERE id='.$actor)->fetchColumn();
    $q=$pdo->prepare("INSERT INTO business_users (business_id,user_id,name,email,role_title,permission_set) VALUES (1,?,'Support test',?,'Test','Test')"); $q->execute([$actor,$marker.'@example.com']); $businessStaff=(int)$pdo->lastInsertId();
    $linked=$service->mutate($actor,array_replace($create,['email'=>$email])); $linkedId=(int)$linked['ticket']['id']; $ids[]=$linkedId;
    $linked=$service->mutate($actor,payload($linked,'note',['body'=>'Private']));
    $q=$pdo->prepare("SELECT COUNT(*) FROM business_notifications WHERE reference_type='contact_inquiry' AND reference_id=?"); $q->execute([$linkedId]); check((int)$q->fetchColumn()===0,'Private note does not notify.');
    $service->mutate($actor,payload($linked,'reply',['body'=>'Public support reply']));
    $q->execute([$linkedId]); check((int)$q->fetchColumn()>=1,'Business notification is delivered for public reply.');
    echo "PASS: create, persistence, legacy inquiry reuse, assignments, filters, pagination, drafts, replies, notes, resolution history, conflicts, validation and business notifications\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($ids as $id) {
        $q=$pdo->prepare("DELETE FROM business_notifications WHERE reference_type='contact_inquiry' AND reference_id=?"); $q->execute([$id]);
        $q=$pdo->prepare("DELETE FROM audit_logs WHERE entity_type='contact_inquiry' AND entity_id=?"); $q->execute([$id]);
        $q=$pdo->prepare('DELETE FROM contact_inquiries WHERE id=?'); $q->execute([$id]);
    }
    if ($businessStaff) $pdo->exec('DELETE FROM business_users WHERE id='.$businessStaff);
}
