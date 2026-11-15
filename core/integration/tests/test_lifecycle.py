from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import threading
import time
import os
from unittest.mock import patch

from brain.baseline import ROOT
from system_integration.codec import parse,write,sha,digest
from system_integration.store import Store,Principal,Problem
from system_integration.c_gateway import ChatGateway

class LifecycleControls(unittest.TestCase):
    def setUp(self):
        self.folder=Path(tempfile.mkdtemp(prefix='lifecycle-unit-',dir=ROOT/'runtime/integration'))
        self.store=Store(self.folder,render_pdf=False,max_pending=3)
        self.request=parse((ROOT/'examples/engine/growth_producing.json').read_text())
        self.principal=Principal('t','owner',(self.request['farm_id'],))

    def tearDown(self):self.store.close()

    def pending(self):
        with patch.object(self.store.executor,'submit'):
            return self.store.create(self.principal,self.request)

    def failed(self,attempts=1):
        state=self.pending();private=self.store.state(self.principal,state['analysis_id'])
        private.update(state='failed',error='WORKER_TIMEOUT',attempts=attempts)
        write(self.folder/state['analysis_id']/'state.json',private)
        self.store.pending=0
        return private

    def test_same_principal_duplicate_coalesces(self):
        first=self.pending();second=self.pending()
        self.assertEqual(first['analysis_id'],second['analysis_id'])
        self.assertEqual(self.store.pending,1)
        self.assertEqual(len(list(self.folder.glob('*/request.json'))),1)

    def test_different_subject_never_coalesces(self):
        first=self.pending()
        with patch.object(self.store.executor,'submit'):
            second=self.store.create(Principal('t','other',self.principal.farms),self.request)
        self.assertNotEqual(first['analysis_id'],second['analysis_id'])
        with self.assertRaises(Problem):self.store.state(self.principal,second['analysis_id'])

    def test_cancel_queued_job_is_durable(self):
        state=self.pending();cancelled=self.store.cancel(self.principal,state['analysis_id'])
        self.assertEqual(cancelled['error'],'JOB_CANCELLED')
        self.assertEqual(cancelled['phase'],'cancelled')
        self.store.close();self.store=Store(self.folder,recover=False)
        self.assertEqual(self.store.state(self.principal,state['analysis_id'])['state'],'failed')

    def test_retry_preserves_request_and_job_identity(self):
        old=self.failed();request=(self.folder/old['analysis_id']/'request.json').read_bytes()
        with patch.object(self.store.executor,'submit'):
            retried=self.store.retry(self.principal,old['analysis_id'])
        self.assertEqual(retried['analysis_id'],old['analysis_id'])
        self.assertEqual(retried['request_id'],old['request_id'])
        self.assertEqual(request,(self.folder/old['analysis_id']/'request.json').read_bytes())
        self.assertEqual(retried['state'],'pending')

    def test_retry_limit_cannot_be_reset(self):
        old=self.failed(3)
        with self.assertRaises(Problem) as raised:self.store.retry(self.principal,old['analysis_id'])
        self.assertEqual(raised.exception.code,'RECOVERY_ATTEMPTS_EXHAUSTED')

    def test_mutated_request_cannot_be_retried(self):
        old=self.failed();changed=deepcopy(self.request);changed['farm_id']='OTHER_FARM'
        write(self.folder/old['analysis_id']/'request.json',changed)
        with self.assertRaises(Problem) as raised:self.store.retry(self.principal,old['analysis_id'])
        self.assertEqual(raised.exception.code,'REQUEST_INTEGRITY_FAILED')

    def test_cancel_terminal_result_is_conflict(self):
        old=self.failed()
        with self.assertRaises(Problem) as raised:self.store.cancel(self.principal,old['analysis_id'])
        self.assertEqual(raised.exception.status,409)

    def test_cross_farm_cancel_and_retry_denied(self):
        old=self.failed();foreign=Principal('t','owner',('OTHER',))
        for action in (self.store.cancel,self.store.retry):
            with self.assertRaises(Problem) as raised:action(foreign,old['analysis_id'])
            self.assertEqual(raised.exception.status,404)

    def test_complete_manifest_recovers_publication_without_rerun(self):
        state=self.pending();path=self.folder/state['analysis_id']
        response=parse((ROOT/'integration/samples/Latest_A/Canonical_API_Response.json').read_text())
        write(path/'result.json',response)
        manifest={'request_sha256':state['request_sha256'],'response_sha256':sha(path/'result.json'),
                  'scientific_result_sha256':response['engine_result']['scientific_result_sha256'],
                  'files':{'request.json':sha(path/'request.json'),'result.json':sha(path/'result.json')},'created_utc':'2026-11-14T00:00:00+00:00'}
        write(path/'manifest.json',manifest)
        self.store.close();self.store=Store(self.folder,recover=False)
        recovered=self.store.result(self.principal,state['analysis_id'])
        self.assertEqual(recovered,response)
        self.assertEqual(self.store.pending,0)

    def test_unpublished_interrupted_file_is_archived(self):
        state=self.pending();path=self.folder/state['analysis_id'];write(path/'result.json',{'incomplete':True})
        self.store.close();self.store=Store(self.folder,recover=False)
        self.assertEqual(self.store.state(self.principal,state['analysis_id'])['state'],'pending')
        self.assertFalse((path/'result.json').exists())
        self.assertTrue(list((path/'attempts').rglob('interrupted-result.json')))

class AtomicFileTests(unittest.TestCase):
    def test_atomic_update_survives_temporary_windows_reader(self):
        folder=Path(tempfile.mkdtemp(prefix='atomic-reader-',dir=ROOT/'runtime/integration'))
        path=folder/'state.json';write(path,{'version':1});errors=[]
        held=path.open('rb')
        def update():
            try:write(path,{'version':2})
            except Exception as error:errors.append(error)
        thread=threading.Thread(target=update);thread.start();time.sleep(.15)
        if os.name=='nt':self.assertTrue(thread.is_alive())
        held.close();thread.join(timeout=3)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
        self.assertEqual(parse(path.read_text()),{'version':2})

class CBoundary(unittest.TestCase):
    def test_missing_C_does_not_claim_live_chat(self):
        class Reader:
            def result(self,principal,aid):return {'farm_id':'f'}
        gateway=ChatGateway(Reader())
        self.assertFalse(gateway.status()['available'])
        self.assertFalse(gateway.status()['live_inference_verified'])
        with self.assertRaises(Problem) as raised:gateway.create(Principal('t','s',('f',)),{'analysis_id':'a'})
        self.assertEqual(raised.exception.code,'C_INTEGRATION_PENDING')

    def test_authorization_checked_before_pending_capability(self):
        class Reader:
            def result(self,principal,aid):raise Problem(404,'ANALYSIS_NOT_FOUND')
        with self.assertRaises(Problem) as raised:ChatGateway(Reader()).create(Principal('t','s',('f',)),{'analysis_id':'foreign'})
        self.assertEqual(raised.exception.status,404)

    def test_native_C_requires_independent_scope_acceptance(self):
        class Reader:
            def result(self,p,a):return {'farm_id':'f','growth_evaluation':{'schema':'native'}}
        with self.assertRaises(Problem) as raised:ChatGateway(Reader(),object()).create(Principal('t','s',('f',)),{'analysis_id':'a'})
        self.assertEqual(raised.exception.code,'NATIVE_C_CONTRACT_PENDING')

if __name__=='__main__':unittest.main()
