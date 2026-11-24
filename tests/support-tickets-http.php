<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__.'/../app/Database/Connection.php';
require_once __DIR__.'/../app/Auth/SessionManager.php';
require_once __DIR__.'/../app/Repositories/UserRepository.php';
require_once __DIR__.'/../app/Services/SupportTicketService.php';
use ClassicClub\Auth\SessionManager;
use ClassicClub\Repositories\UserRepository;
function check(bool $value,string $message): void { if (!$value) throw new RuntimeException($message); }
$base=rtrim($argv[1] ?? 'http://localhost/classic-club-ph', '/');
$actor=(int)$pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN business_users bu ON bu.user_id=u.id WHERE r.name='admin' AND u.status='active' AND u.deleted_at IS NULL AND bu.business_id=1 AND bu.status='active' AND bu.permission_set='owner' ORDER BY u.id LIMIT 1")->fetchColumn();
$superAdmin=(int)$pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='super_admin' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
$customer=(int)$pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='customer' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
check($actor>0 && $superAdmin>0 && $customer>0,'Active Business Owner, Super Admin and customer accounts required.');
$sessions=[];
function testSession(int $user): array {
    session_id('supporttest'.bin2hex(random_bytes(16))); SessionManager::login($user);
    $session=['cookie'=>session_name().'='.session_id(),'token'=>$_SESSION['csrf_token'],'id'=>session_id()];
    session_write_close();
    return $session;
}
function request(string $path, ?array $session=null, ?array $body=null, bool $csrf=true, bool $multipart=false, string $method='POST'): array {
    global $base;
    $c=curl_init($base.$path); $headers=['Accept: application/json'];
    if ($session) $headers[]='Cookie: '.$session['cookie'];
    if ($body!==null) {
        if ($csrf && $session) $headers[]='X-CSRF-Token: '.$session['token'];
        if (!$multipart) $headers[]='Content-Type: application/json';
        curl_setopt($c,CURLOPT_CUSTOMREQUEST,$method); curl_setopt($c,CURLOPT_POSTFIELDS,$multipart ? $body : json_encode($body));
    }
    curl_setopt_array($c,[CURLOPT_HTTPHEADER=>$headers,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20]);
    $raw=curl_exec($c); $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); $error=curl_error($c); curl_close($c);
    if ($raw===false) throw new RuntimeException($error);
    return ['status'=>$status,'json'=>json_decode($raw,true),'raw'=>$raw];
}
$testIds=[]; $testUsers=[]; $otherBusiness=0; $temporary=tempnam(sys_get_temp_dir(),'support'); $stored=null; $fixture=null;
$marker='support-browser-'.bin2hex(random_bytes(8)); $browserStatus=0; $browserOutput=[];
try {
    $pdo->prepare('INSERT INTO businesses (name,slug) VALUES (?,?)')->execute(['Support test business',$marker]);
    $otherBusiness=(int)$pdo->lastInsertId();
    $repo=new UserRepository($pdo);
    foreach (['owner','inventory_manager'] as $permissionSet) {
        $email=$permissionSet.'-'.$marker.'@example.com';
        $user=$repo->create($email,password_hash(bin2hex(random_bytes(16)),PASSWORD_DEFAULT),'Support','Test');
        $testUsers[$permissionSet]=$user;
        $repo->assignRole($user,'admin');
        $pdo->prepare("INSERT INTO business_users (business_id,user_id,name,email,role_title,permission_set,status) VALUES (?,?,'Support Test',?,?,?,'active')")
            ->execute([$otherBusiness,$user,$email,$permissionSet,$permissionSet]);
    }
    $sessions=array_map('testSession',[$actor,$customer,$superAdmin,$testUsers['owner'],$testUsers['inventory_manager']]);
    [$admin,$ordinary,$system,$otherOwner,$nonOwner]=$sessions;
    $endpoint='/public/api/admin/tickets.php';
    check(request($endpoint)['status']===401,'Anonymous denied.');
    check(request($endpoint,$ordinary)['status']===403,'Customer denied.');
    check(request($endpoint,$system)['status']===403,'Super Admin denied.');
    check(request($endpoint,$nonOwner)['status']===403,'Non-owner Admin denied.');
    check(request('/public/api/super-admin/tickets.php',$system)['status']===404,'Previous ticket endpoint is removed.');
    check(request($endpoint,$admin,[],false)['status']===403,'Missing CSRF denied.');
    check(request($endpoint.'?status[]=open',$admin)['status']===422,'Malformed filter rejected.');
    $create=['action'=>'create','full_name'=>'HTTP support test','email'=>'http-support@example.com','subject'=>'HTTP support test','message'=>'HTTP original request','priority'=>'Medium','category'=>'Other'];
    $r=request($endpoint,$admin,$create);
    check($r['status']===200,'Create request succeeds: '.$r['raw']);
    $d=$r['json']['data']; $id=(int)$d['ticket']['id']; $testIds[]=$id;
    $outside=request($endpoint,$otherOwner,$create);
    check($outside['status']===200,'A second Business Owner can create a ticket in their own business.');
    $outsideId=(int)$outside['json']['data']['ticket']['id']; $testIds[]=$outsideId;
    $outsideList=request($endpoint.'?search=INQ-'.$outsideId,$otherOwner)['json']['data'];
    check($outsideList['total']===1 && (int)$outsideList['stats']['unresolved']===1,'Ticket list and totals are business-specific.');
    check(!in_array($actor,array_map('intval',array_column($outsideList['agents'],'id')),true),'Assignees are business-specific.');
    check(request($endpoint.'?search=INQ-'.$outsideId,$admin)['json']['data']['total']===0,'Other business tickets are excluded from search.');
    check(request($endpoint.'?id='.$id,$otherOwner)['status']===404,'Other business ticket detail is inaccessible.');
    check(request($endpoint,$otherOwner,['action'=>'note','id'=>$id,'version'=>$d['ticket']['version'],'updated_at'=>$d['ticket']['updated_at'],'body'=>'Other workspace'])['status']===404,'Other business ticket actions are denied.');
    $legacyList=request('/public/api/admin/inquiries.php',$otherOwner)['json']['data'];
    check(!in_array($id,array_map('intval',array_column($legacyList,'id')),true),'Inquiry list shares business scope.');
    check(request('/public/api/admin/inquiry-status.php',$otherOwner,['id'=>$id,'status'=>'resolved'],true,false,'PATCH')['status']===404,'Inquiry status endpoint shares business scope.');

    $contact=request('/public/api/contact/submit.php',$ordinary,['full_name'=>'Contact test','email'=>'contact-support@example.com','topic'=>'sizing','message'=>'Contact form inquiry'],true,true);
    check($contact['status']===201,'Original Contact form submission succeeds.');
    $contactId=(int)$contact['json']['data']['inquiry_id']; $testIds[]=$contactId;
    check(request($endpoint.'?id='.$contactId,$admin)['json']['data']['ticket']['category']==='Sizing','Public Contact inquiries are available in the storefront queue.');
    check(request($endpoint.'?id='.$contactId,$otherOwner)['status']===404,'Only the storefront business can read its Contact submissions.');
    file_put_contents($temporary,"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    $t=$d['ticket'];
    $r=request($endpoint,$admin,['action'=>'attachment','id'=>$id,'version'=>$t['version'],'updated_at'=>$t['updated_at'],'attachment'=>new CURLFile($temporary,'application/pdf','support-test.pdf')],true,true);
    check($r['status']===200,'Real upload succeeds: '.$r['raw']);
    $attachment=$r['json']['data']['attachments'][0];
    $q=$pdo->prepare('SELECT storage_path FROM inquiry_attachments WHERE id=?'); $q->execute([$attachment['id']]); $stored=$q->fetchColumn();
    check(is_file($stored),'Upload stored.');
    $download='/public/api/admin/ticket-attachment.php?id='.$attachment['id'];
    check(request($download)['status']===401 && request($download,$ordinary)['status']===403 && request($download,$system)['status']===403,'Attachment permission enforced.');
    check(request($download,$otherOwner)['status']===404,'Other business attachments are inaccessible.');
    check(request('/public/api/admin/inquiry-attachment.php?id='.$attachment['id'],$otherOwner)['status']===404,'Inquiry download shares business scope.');
    check(request($download,$admin)['raw']===file_get_contents($temporary),'Authorized download matches uploaded bytes.');
    check(request('/storage/support/'.basename($stored))['status']===403,'Direct attachment URL is denied.');
    check(request($endpoint.'?id='.$id,$admin)['json']['data']['ticket']['id']==$id,'Detail reload persists.');
    if (isset($argv[2])) {
        $service=new \ClassicClub\Services\SupportTicketService($pdo, 1);
        $create=['action'=>'create','full_name'=>'Browser ticket test','email'=>$marker.'@example.com','subject'=>$marker,'message'=>'Original request <script>literal markup</script>','category'=>'Other','priority'=>'Medium'];
        for ($i=0;$i<21;$i++) $service->mutate($actor,$create);
        $first=$service->mutate($actor,$create); $browserId=(int)$first['ticket']['id'];
        for ($i=0;$i<31;$i++) {
            $t=$first['ticket'];
            $first=$service->mutate($actor,['action'=>'note','id'=>$browserId,'version'=>$t['version'],'updated_at'=>$t['updated_at'],'body'=>'History test '.$i]);
        }
        $fixture=tempnam(sys_get_temp_dir(),'support-browser');
        file_put_contents($fixture,json_encode(['base'=>$base,'session'=>$admin,'marker'=>$marker,'id'=>$browserId,'actor'=>$actor],JSON_THROW_ON_ERROR));
        exec('node '.escapeshellarg($argv[2]).' '.escapeshellarg($fixture).' 2>&1',$browserOutput,$browserStatus);
    }
} finally {
    $q=$pdo->prepare('SELECT id FROM contact_inquiries WHERE email=?'); $q->execute([$marker.'@example.com']);
    foreach (array_merge($testIds,$q->fetchAll(PDO::FETCH_COLUMN)) as $testId) {
        $attachments=$pdo->prepare('SELECT storage_path FROM inquiry_attachments WHERE inquiry_id=?'); $attachments->execute([$testId]);
        foreach ($attachments->fetchAll(PDO::FETCH_COLUMN) as $testPath) if (is_file($testPath)) unlink($testPath);
        $pdo->prepare("DELETE FROM business_notifications WHERE reference_type='contact_inquiry' AND reference_id=?")->execute([$testId]);
        $pdo->prepare("DELETE FROM audit_logs WHERE entity_type='contact_inquiry' AND entity_id=?")->execute([$testId]);
        $pdo->prepare('DELETE FROM contact_inquiries WHERE id=?')->execute([$testId]);
    }
    foreach ($testUsers as $user) {
        $pdo->prepare('DELETE FROM business_users WHERE user_id=?')->execute([$user]);
        $pdo->prepare('DELETE FROM users WHERE id=?')->execute([$user]);
    }
    if ($otherBusiness) $pdo->prepare('DELETE FROM businesses WHERE id=?')->execute([$otherBusiness]);
    if ($stored && is_file($stored)) unlink($stored);
    if (is_file($temporary)) unlink($temporary);
    if ($fixture && is_file($fixture)) unlink($fixture);
    foreach ($sessions as $session) { session_id($session['id']); SessionManager::start(); $_SESSION=[]; session_destroy(); }
}
if ($browserOutput) echo implode(PHP_EOL,$browserOutput).PHP_EOL;
check($browserStatus===0,'Browser ticket checks pass.');
echo "PASS: HTTP authentication, Business Owner access, business isolation, CSRF, Contact submissions, creation, real multipart upload, protected download and persistence\n";
