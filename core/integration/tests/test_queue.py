import tempfile,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
from brain.baseline import ROOT
from system_integration.codec import read,write,now
from system_integration.store import Store,Principal,Problem
from system_integration.queueing import DurationHistory,queue_dto,workload

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.identity=patch('system_integration.source_identity.identity',return_value={'test_only':True});self.identity.start()
        self.folder=Path(tempfile.mkdtemp(prefix='fifo-test-',dir=ROOT/'runtime/integration'))
        self.store=Store(self.folder,render_pdf=False,max_pending=3)
        self.payload=read(ROOT/'examples/engine/growth_producing.json')
        self.users=[Principal('tenant'+str(i),'subject'+str(i),(self.payload['farm_id'],)) for i in range(4)]
    def tearDown(self):self.store.close();self.identity.stop()
    def submit(self,i):
        with patch.object(self.store.executor,'submit'):return self.store.create(self.users[i],self.payload)
    def test_three_users_FIFO_positions_and_no_metadata(self):
        jobs=[self.submit(i) for i in range(3)]
        for i,j in enumerate(jobs):
            q=self.store.queue_status(self.users[i],j['analysis_id'])
            self.assertEqual((q['analyses_ahead'],q['queue_position']),(i,i+1))
            self.assertIsNone(q['estimated_start_wait_seconds'] if i else None)
            raw=str(q)
            for other in jobs:
                if other!=j:self.assertNotIn(other['analysis_id'],raw)
            self.assertNotIn('tenant',raw);self.assertNotIn('subject',raw);self.assertNotIn('farm_id',raw)
        with self.assertRaises(Problem) as e:self.store.queue_status(self.users[1],jobs[0]['analysis_id'])
        self.assertEqual(e.exception.status,404)
    def test_running_not_waiting_and_wait_estimate_null(self):
        first=self.submit(0);last=self.submit(1);self.store._running_id=first['analysis_id']
        state=self.store.state(self.users[0],first['analysis_id']);state.update(started_utc=now(),attempts=1,phase='computing');write(self.folder/first['analysis_id']/'state.json',state)
        self.assertIsNone(self.store.queue_status(self.users[0],first['analysis_id'])['queue_position'])
        q=self.store.queue_status(self.users[1],last['analysis_id']);self.assertEqual((q['analyses_ahead'],q['queue_position']),(1,1));self.assertIsNone(q['estimated_start_wait_interval_seconds'])
    def test_dedupe_capacity_and_cancel_retry_tail(self):
        a=self.submit(0);b=self.submit(1);c=self.submit(2)
        self.assertEqual(self.submit(0)['analysis_id'],a['analysis_id'])
        with self.assertRaises(Problem) as e:self.submit(3)
        self.assertEqual(e.exception.code,'COMPUTE_QUEUE_LIMIT')
        self.store.cancel(self.users[1],b['analysis_id'])
        self.assertEqual(self.store.queue_status(self.users[1],b['analysis_id'])['status'],'cancelled')
        with patch.object(self.store.executor,'submit'):self.store.retry(self.users[1],b['analysis_id'])
        self.assertGreater(self.store.state(self.users[1],b['analysis_id'])['queue_sequence'],self.store.state(self.users[2],c['analysis_id'])['queue_sequence'])
        self.assertEqual(self.store.queue_status(self.users[1],b['analysis_id'])['analyses_ahead'],2)
    def test_recovery_uses_sequences_not_uuid(self):
        jobs=[self.submit(i) for i in range(3)];expected=[j['analysis_id'] for j in jobs]
        # Deliberately make creation timestamps reverse order; persisted admission wins.
        for i,j in enumerate(jobs):
            s=self.store.state(self.users[i],j['analysis_id']);s['created_utc']='2026-11-'+str(20-i)+'T00:00:00+00:00';write(self.folder/j['analysis_id']/'state.json',s)
        self.store.close()
        with patch('system_integration.store.ThreadPoolExecutor') as pool:
            self.store=Store(self.folder,render_pdf=False)
            actual=[x.args[1] for x in pool.return_value.submit.call_args_list]
        self.assertEqual(actual,expected)
    def test_legacy_migration_uses_created_utc(self):
        jobs=[self.submit(i) for i in range(3)]
        for i,j in enumerate(jobs):
            s=self.store.state(self.users[i],j['analysis_id']);s.pop('queue_sequence');s['created_utc']='2026-11-'+str(20-i)+'T00:00:00+00:00';write(self.folder/j['analysis_id']/'state.json',s)
        self.store.close()
        with patch('system_integration.store.ThreadPoolExecutor') as pool:
            self.store=Store(self.folder,render_pdf=False)
            actual=[x.args[1] for x in pool.return_value.submit.call_args_list]
        self.assertEqual(actual,[j['analysis_id'] for j in reversed(jobs)])
    def test_estimate_requires_three_actual_samples_and_is_start_only(self):
        a=self.submit(0);b=self.submit(1);s=self.store.state(self.users[0],a['analysis_id'])
        for i,v in enumerate([100,180,240]):self.store.history.add(s['queue_workload'],v,'test-only-'+str(i))
        q=self.store.queue_status(self.users[1],b['analysis_id']);bounds=q['estimated_start_wait_interval_seconds']
        self.assertEqual(q['estimation_basis']['target'],'START');self.assertLessEqual(bounds['lower'],100);self.assertGreaterEqual(bounds['upper'],240);self.assertFalse(q['estimation_basis']['guaranteed'])
        self.store.close();self.store=Store(self.folder,recover=False)
        self.assertEqual(len(self.store.history.records),3)
    def test_history_is_bounded_and_host_specific(self):
        for i in range(25):self.store.history.add('p',100+i,'test-'+str(i))
        self.assertEqual(len(self.store.history.records),20)
        h=read(self.store.history.path);h['host_fingerprint']='different-host';write(self.store.history.path,h)
        self.assertEqual(DurationHistory(self.store.history.path).records,[])
    def test_duplicate_sequence_fails_closed(self):
        a=self.submit(0);b=self.submit(1);s=self.store.state(self.users[1],b['analysis_id']);s['queue_sequence']=self.store.state(self.users[0],a['analysis_id'])['queue_sequence'];write(self.folder/b['analysis_id']/'state.json',s);self.store.close()
        with self.assertRaisesRegex(ValueError,'QUEUE_ORDER_INTEGRITY_FAILED'):Store(self.folder,recover=False)

if __name__=='__main__':unittest.main()
