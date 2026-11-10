<?php
declare(strict_types=1);
namespace ClassicClub\Services;

require_once __DIR__ . '/../Repositories/InquiryRepository.php';
require_once __DIR__ . '/../Support/AuditLogger.php';
require_once __DIR__ . '/AdminBusinessService.php';

use PDO;
use InvalidArgumentException;
use RuntimeException;
use Throwable;
use ClassicClub\Repositories\InquiryRepository;
use ClassicClub\Support\AuditLogger;

final class SupportTicketService
{
    public const CATEGORIES = ['Order / checkout', 'Inventory report', 'Account access', 'Business permissions', 'Account appeal', 'Delivery question', 'Report export', 'Product information', 'Sizing', 'Returns', 'Other'];
    public const STATUSES = ['open','in_progress','resolved','closed'];
    public const PRIORITIES = ['Critical','High','Medium','Low'];
    public function __construct(private readonly PDO $pdo) {}

    private function query(string $sql, array $args = []): \PDOStatement
    {
        $q = $this->pdo->prepare($sql); $q->execute($args); return $q;
    }
    private function text(array $data, string $key, int $max, bool $required = true): string
    {
        $value = $data[$key] ?? '';
        if (!is_string($value) || mb_strlen(trim($value)) > $max || ($required && trim($value) === '')) throw new InvalidArgumentException("Invalid $key (maximum $max characters).");
        return trim($value);
    }
    public function integer(mixed $value): int
    {
        $id = filter_var($value, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>1000000000]]);
        if ($id === false) throw new InvalidArgumentException('A positive integer is required.');
        return $id;
    }
    private function choice(array $data, string $key, array $choices): string
    {
        $value = $this->text($data, $key, 80);
        if (!in_array($value, $choices, true)) throw new InvalidArgumentException("Invalid $key.");
        return $value;
    }
    public function agents(): array
    {
        return $this->query("SELECT u.id, CONCAT(u.first_name,' ',u.last_name) AS name FROM users u WHERE u.status='active' AND u.deleted_at IS NULL AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='super_admin') ORDER BY name,u.id")->fetchAll();
    }
    private function assignee(mixed $id): ?int
    {
        if ($id === null || $id === '') return null;
        $id = $this->integer($id);
        foreach ($this->agents() as $agent) if ((int)$agent['id'] === $id) return $id;
        throw new InvalidArgumentException('Choose an active Super Admin support agent.');
    }
    private function base(): string
    {
        return "SELECT i.*, COALESCE(d.subject,CONCAT('Contact inquiry: ',i.topic)) AS subject, COALESCE(d.category,CASE i.topic WHEN 'order' THEN 'Order / checkout' WHEN 'sizing' THEN 'Sizing' WHEN 'return' THEN 'Returns' ELSE 'Other' END) AS category, COALESCE(d.priority,'Medium') AS priority, COALESCE(d.version,0) AS version, d.resolution_summary,d.first_response_at,d.resolved_at,d.closed_at, CONCAT(u.first_name,' ',u.last_name) AS assignee FROM contact_inquiries i LEFT JOIN support_ticket_details d ON d.inquiry_id=i.id LEFT JOIN users u ON u.id=i.assigned_to";
    }
    public function listing(array $data): array
    {
        $page = $this->integer($data['page'] ?? 1); $where = []; $args = [];
        $search = $this->text($data,'search',200,false);
        if ($search !== '') {
            $where[] = "(CAST(t.id AS CHAR)=? OR CONCAT('INQ-',t.id)=? OR t.full_name LIKE ? OR t.email LIKE ? OR t.subject LIKE ? OR t.message LIKE ?)";
            $args = [$search,$search,...array_fill(0,4,'%'.strtr($search,['!'=>'!!','%'=>'!%','_'=>'!_']).'%')];
            $where[0] = str_replace('LIKE ?', "LIKE ? ESCAPE '!'", $where[0]);
        }
        foreach (['status'=>self::STATUSES,'priority'=>self::PRIORITIES,'category'=>self::CATEGORIES] as $key=>$choices) {
            if (($data[$key] ?? '') !== '') { $where[] = "t.$key=?"; $args[] = $this->choice($data,$key,$choices); }
        }
        if (($data['assigned_to'] ?? '') !== '') {
            if ($data['assigned_to'] === 'unassigned') $where[] = 't.assigned_to IS NULL';
            else { $where[] = 't.assigned_to=?'; $args[] = $this->integer($data['assigned_to']); }
        }
        $from = ' FROM ('.$this->base().') t'.($where ? ' WHERE '.implode(' AND ',$where) : '');
        $total = (int)$this->query('SELECT COUNT(*)'.$from,$args)->fetchColumn();
        $pages = max(1,(int)ceil($total/20)); $page = min($page,$pages); $offset = ($page-1)*20;
        $rows = $this->query('SELECT *'.$from." ORDER BY t.created_at DESC,t.id DESC LIMIT 20 OFFSET $offset",$args)->fetchAll();
        $stats = $this->query("SELECT SUM(i.status IN ('open','in_progress')) AS unresolved, SUM(i.status IN ('resolved','closed')) AS completed, AVG(TIMESTAMPDIFF(MINUTE,i.created_at,d.first_response_at)) AS response_minutes, AVG(TIMESTAMPDIFF(MINUTE,i.created_at,d.resolved_at)) AS resolution_minutes FROM contact_inquiries i LEFT JOIN support_ticket_details d ON d.inquiry_id=i.id")->fetch();
        return compact('rows','total','page','pages','stats') + ['agents'=>$this->agents(),'categories'=>self::CATEGORIES];
    }
    public function detail(int $id, int $actor, int $page = 1): array
    {
        $ticket = $this->query($this->base().' WHERE i.id=?',[$id])->fetch();
        if (!$ticket) throw new RuntimeException('Ticket not found.',404);
        $total = (int)$this->query('SELECT COUNT(*) FROM support_ticket_entries WHERE inquiry_id=?',[$id])->fetchColumn();
        $pages = max(1,(int)ceil($total/30)); $page = min($page,$pages); $offset = ($page-1)*30;
        $entries = $this->query("SELECT e.*,CONCAT(u.first_name,' ',u.last_name) AS author FROM support_ticket_entries e LEFT JOIN users u ON u.id=e.actor_id WHERE e.inquiry_id=? ORDER BY e.id DESC LIMIT 30 OFFSET $offset",[$id])->fetchAll();
        $attachments = $this->query('SELECT id,original_name,file_size,created_at FROM inquiry_attachments WHERE inquiry_id=? ORDER BY id',[$id])->fetchAll();
        $draft = $this->query('SELECT body FROM support_ticket_drafts WHERE inquiry_id=? AND actor_id=?',[$id,$actor])->fetchColumn() ?: '';
        return compact('ticket','entries','attachments','draft','page','pages','total');
    }
    private function entry(int $id, int $actor, string $kind, string $body): void
    {
        $this->query('INSERT INTO support_ticket_entries (inquiry_id,actor_id,kind,body) VALUES (?,?,?,?)',[$id,$actor,$kind,$body]);
    }
    public function mutate(int $actor, array $data, ?array $file = null): array
    {
        $action = $this->choice($data,'action',['create','update','reply','note','draft','attachment']);
        $storedPath = null;
        $this->pdo->beginTransaction();
        try {
            if ($action === 'create') {
                $name=$this->text($data,'full_name',160); $email=$this->text($data,'email',190);
                if (!filter_var($email,FILTER_VALIDATE_EMAIL)) throw new InvalidArgumentException('A valid requester email is required.');
                $subject=$this->text($data,'subject',200); $message=$this->text($data,'message',10000);
                $category=$this->choice($data,'category',self::CATEGORIES); $priority=$this->choice($data,'priority',self::PRIORITIES);
                $assigned=$this->assignee($data['assigned_to'] ?? null); $order=$this->text($data,'order_number',30,false);
                $user=$this->query('SELECT id FROM users WHERE email=? AND deleted_at IS NULL',[$email])->fetchColumn();
                $topic=match($category) {'Order / checkout','Delivery question'=>'order','Sizing'=>'sizing','Returns'=>'return',default=>'other'};
                $id=(new InquiryRepository($this->pdo))->create(['user_id'=>$user ?: null,'full_name'=>$name,'email'=>$email,'topic'=>$topic,'order_number'=>$order ?: null,'message'=>$message]);
                $this->query('UPDATE contact_inquiries SET assigned_to=? WHERE id=?',[$assigned,$id]);
                $this->query('INSERT INTO support_ticket_details (inquiry_id,subject,category,priority) VALUES (?,?,?,?)',[$id,$subject,$category,$priority]);
                $this->entry($id,$actor,'history','Ticket created. Assigned to '.($assigned ?? 'Unassigned').'.');
            } else {
                $id=$this->integer($data['id'] ?? null);
                // Serialize all module writes on the canonical inquiry, including legacy inquiries.
                if (!$this->query('SELECT id FROM contact_inquiries WHERE id=? FOR UPDATE',[$id])->fetchColumn()) throw new RuntimeException('Ticket not found.',404);
                $ticket=$this->detail($id,$actor)['ticket'];
                if (!isset($data['version']) || !is_numeric($data['version']) || (string)(int)$data['version'] !== (string)$data['version'] || (int)$data['version'] !== (int)$ticket['version'] || ($data['updated_at'] ?? null) !== $ticket['updated_at']) throw new RuntimeException('Ticket changed. Reload it before saving.',409);
                $this->query('INSERT IGNORE INTO support_ticket_details (inquiry_id,subject,category) VALUES (?,?,?)',[$id,$ticket['subject'],$ticket['category']]);
                if ($action === 'update') {
                    $status=$this->choice($data,'status',self::STATUSES); $priority=$this->choice($data,'priority',self::PRIORITIES); $category=$this->choice($data,'category',self::CATEGORIES);
                    $subject=$this->text($data,'subject',200); $summary=$this->text($data,'resolution_summary',10000,false); $assigned=$this->assignee($data['assigned_to'] ?? null);
                    if (in_array($status,['resolved','closed'],true) && $summary==='') throw new InvalidArgumentException('A resolution summary is required.');
                    $changes=[];
                    foreach (['status'=>$status,'priority'=>$priority,'category'=>$category,'subject'=>$subject,'assigned_to'=>$assigned,'resolution_summary'=>$summary] as $key=>$value) if ((string)($ticket[$key] ?? '') !== (string)$value) $changes[$key]=['from'=>$ticket[$key] ?? null,'to'=>$value];
                    $this->query('UPDATE contact_inquiries SET status=?,assigned_to=?,updated_at=NOW() WHERE id=?',[$status,$assigned,$id]);
                    $completed=in_array($status,['resolved','closed'],true);
                    $now=$this->query('SELECT CURRENT_TIMESTAMP')->fetchColumn();
                    $resolved=$completed ? ($ticket['resolved_at'] ?: $now) : null;
                    $closed=$status==='closed' ? ($ticket['closed_at'] ?: $now) : null;
                    $this->query('UPDATE support_ticket_details SET subject=?,category=?,priority=?,resolution_summary=?,resolved_at=?,closed_at=? WHERE inquiry_id=?',[$subject,$category,$priority,$summary,$resolved,$closed,$id]);
                    if ($changes) $this->entry($id,$actor,'history',json_encode($changes,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE));
                } elseif ($action === 'attachment') {
                    if (!$file || !is_string($file['tmp_name'] ?? null) || ($file['error'] ?? -1) !== UPLOAD_ERR_OK || ($file['size'] ?? 0) < 1 || $file['size'] > 5242880 || !is_uploaded_file($file['tmp_name'])) throw new InvalidArgumentException('Choose a JPG, PNG or PDF file up to 5 MB.');
                    $mime=(new \finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
                    $extensions=['image/jpeg'=>'jpg','image/png'=>'png','application/pdf'=>'pdf'];
                    if (!isset($extensions[$mime])) throw new InvalidArgumentException('Only JPG, PNG and PDF files are allowed.');
                    $directory=__DIR__.'/../../storage/support';
                    if (!is_dir($directory)) throw new RuntimeException('Support attachment storage is unavailable.');
                    $stored=bin2hex(random_bytes(24)).'.'.$extensions[$mime]; $storedPath=$directory.'/'.$stored;
                    if (!move_uploaded_file($file['tmp_name'],$storedPath)) throw new RuntimeException('Unable to save attachment.');
                    chmod($storedPath,0600);
                    $name=mb_substr(basename(str_replace('\\','/',(string)$file['name'])),0,255);
                    (new InquiryRepository($this->pdo))->addAttachment($id,['original_name'=>$name,'stored_name'=>$stored,'mime_type'=>$mime,'file_size'=>(int)$file['size'],'storage_path'=>$storedPath]);
                    $this->entry($id,$actor,'history','Attachment added: '.$name);
                } else {
                    $body=$this->text($data,'body',10000,$action!=='draft');
                    if ($action==='draft') $this->query('INSERT INTO support_ticket_drafts (inquiry_id,actor_id,body) VALUES (?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body)',[$id,$actor,$body]);
                    else {
                        $this->entry($id,$actor,$action,$body);
                        if ($action==='reply') {
                            $this->query('UPDATE support_ticket_details SET first_response_at=COALESCE(first_response_at,NOW()) WHERE inquiry_id=?',[$id]);
                            $this->query('DELETE FROM support_ticket_drafts WHERE inquiry_id=? AND actor_id=?',[$id,$actor]);
                            // Reuse business notification delivery only for the requester's actual businesses.
                            $businesses=$this->query("SELECT DISTINCT business_id FROM business_users WHERE user_id=? AND status='active'",[$ticket['user_id']])->fetchAll(PDO::FETCH_COLUMN);
                            foreach ($businesses as $business) (new AdminBusinessService($this->pdo))->createNotification((int)$business,'Support reply: INQ-'.$id,'support',$body,'contact_inquiry',(string)$id,'');
                        }
                    }
                }
                $this->query('UPDATE support_ticket_details SET version=version+1 WHERE inquiry_id=?',[$id]);
                $this->query('UPDATE contact_inquiries SET updated_at=NOW() WHERE id=?',[$id]);
            }
            (new AuditLogger($this->pdo))->record('support_ticket.'.$action,$actor,'contact_inquiry',$id);
            $result=$this->detail($id,$actor);
            $this->pdo->commit();
            return $result;
        } catch (Throwable $e) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($storedPath && is_file($storedPath)) unlink($storedPath); throw $e; }
    }
}
