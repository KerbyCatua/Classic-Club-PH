<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__.'/../app/Database/Connection.php';
require_once __DIR__.'/../app/Auth/SessionManager.php';
require_once __DIR__.'/../app/Services/SupportTicketService.php';
use ClassicClub\Auth\SessionManager;
function check(bool $value,string $message): void { if (!$value) throw new RuntimeException($message); }
$base=$argv[1] ?? 'http://localhost/classic-club-ph';
$actor=(int)$pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='super_admin' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
$customer=(int)$pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='customer' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
check($actor>0 && $customer>0,'Active Super Admin and customer accounts required.');
// Isolated test sessions, never use or change an existing browser session.
$sessions=[];
foreach ([$actor,$customer] as $user) {
    session_id('supporttest'.bin2hex(random_bytes(16))); SessionManager::login($user);
    $sessions[]=['cookie'=>session_name().'='.session_id(),'token'=>$_SESSION['csrf_token'],'id'=>session_id()];
    session_write_close();
}
function request(string $path, ?array $session=null, ?array $body=null, bool $csrf=true, bool $multipart=false): array {
    global $base;
    $c=curl_init($base.$path); $headers=['Accept: application/json'];
    if ($session) $headers[]='Cookie: '.$session['cookie'];
    if ($body!==null) {
        if ($csrf && $session) $headers[]='X-CSRF-Token: '.$session['token'];
        if (!$multipart) $headers[]='Content-Type: application/json';
        curl_setopt($c,CURLOPT_POST,true); curl_setopt($c,CURLOPT_POSTFIELDS,$multipart ? $body : json_encode($body));
    }
    curl_setopt_array($c,[CURLOPT_HTTPHEADER=>$headers,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>20]);
    $raw=curl_exec($c); $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); $error=curl_error($c); curl_close($c);
    if ($raw===false) throw new RuntimeException($error);
    return ['status'=>$status,'json'=>json_decode($raw,true),'raw'=>$raw];
}
$id=0; $temporary=tempnam(sys_get_temp_dir(),'support'); $stored=null; $fixture=null;
$marker='support-browser-'.bin2hex(random_bytes(8)); $browserStatus=0; $browserOutput=[];
try {
    $endpoint='/public/api/super-admin/tickets.php'; $admin=$sessions[0]; $ordinary=$sessions[1];
    check(request($endpoint)['status']===401,'Anonymous denied.');
    check(request($endpoint,$ordinary)['status']===403,'Customer denied.');
    check(request($endpoint,$admin,[],false)['status']===403,'Missing CSRF denied.');
    check(request($endpoint.'?status[]=open',$admin)['status']===422,'Malformed filter rejected.');
    $r=request($endpoint,$admin,['action'=>'create','full_name'=>'HTTP support test','email'=>'http-support@example.com','subject'=>'HTTP support test','message'=>'HTTP original request','priority'=>'Medium','category'=>'Other']);
    check($r['status']===200,'Create request succeeds: '.$r['raw']);
    $d=$r['json']['data']; $id=(int)$d['ticket']['id'];
    file_put_contents($temporary,"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    $t=$d['ticket'];
    $r=request($endpoint,$admin,['action'=>'attachment','id'=>$id,'version'=>$t['version'],'updated_at'=>$t['updated_at'],'attachment'=>new CURLFile($temporary,'application/pdf','support-test.pdf')],true,true);
    check($r['status']===200,'Real upload succeeds: '.$r['raw']);
    $attachment=$r['json']['data']['attachments'][0];
    $q=$pdo->prepare('SELECT storage_path FROM inquiry_attachments WHERE id=?'); $q->execute([$attachment['id']]); $stored=$q->fetchColumn();
    check(is_file($stored),'Upload stored.');
    $download='/public/api/super-admin/ticket-attachment.php?id='.$attachment['id'];
    check(request($download)['status']===401 && request($download,$ordinary)['status']===403,'Attachment permission enforced.');
    check(request($download,$admin)['raw']===file_get_contents($temporary),'Authorized download matches uploaded bytes.');
    check(request('/storage/support/'.basename($stored))['status']===403,'Direct attachment URL is denied.');
    check(request($endpoint.'?id='.$id,$admin)['json']['data']['ticket']['id']==$id,'Detail reload persists.');
    if (isset($argv[2])) {
        $service=new \ClassicClub\Services\SupportTicketService($pdo);
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
    foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $testId) {
        $attachments=$pdo->prepare('SELECT storage_path FROM inquiry_attachments WHERE inquiry_id=?'); $attachments->execute([$testId]);
        foreach ($attachments->fetchAll(PDO::FETCH_COLUMN) as $testPath) if (is_file($testPath)) unlink($testPath);
        $pdo->prepare("DELETE FROM audit_logs WHERE entity_type='contact_inquiry' AND entity_id=?")->execute([$testId]);
        $pdo->prepare('DELETE FROM contact_inquiries WHERE id=?')->execute([$testId]);
    }
    if ($id) {
        $q=$pdo->prepare("DELETE FROM audit_logs WHERE entity_type='contact_inquiry' AND entity_id=?"); $q->execute([$id]);
        $q=$pdo->prepare('DELETE FROM contact_inquiries WHERE id=?'); $q->execute([$id]);
    }
    if ($stored && is_file($stored)) unlink($stored);
    if (is_file($temporary)) unlink($temporary);
    if ($fixture && is_file($fixture)) unlink($fixture);
    foreach ($sessions as $session) { session_id($session['id']); SessionManager::start(); $_SESSION=[]; session_destroy(); }
}
if ($browserOutput) echo implode(PHP_EOL,$browserOutput).PHP_EOL;
check($browserStatus===0,'Browser ticket checks pass.');
echo "PASS: HTTP authentication, role checks, CSRF, malformed input, creation, real multipart upload, protected download and persistence\n";
