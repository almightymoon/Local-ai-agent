"""Opt-in live coding smoke check, confined to a disposable fixture.

Only the exact expected edit and unittest command are approved. Not part of CI.
"""
import ast
import json
import os
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp(prefix="zentra-coding-check-"))
(root / 'calculator.py').write_text('def add(a, b):\n    return a - b\n')
(root / 'test_calculator.py').write_text('import unittest\nfrom calculator import add\nclass TestAdd(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n')
os.environ['AGENT_WORKSPACE'] = str(root)
os.environ['DB_PATH'] = str(root / 'state.sqlite3')
from app.agent.orchestrator import run
from app.tools import registry
from app.model_runtime import LocalModelRouter

router = LocalModelRouter()
print('Testing', router.model, 'in', root, flush=True)
expected = ast.dump(ast.parse('def add(a,b):\n return a+b\n'))
events = run(router, 'Fix add in calculator.py to add two numbers. Read it, make the one-line fix with write_file, then run python3 -m unittest -v. Do not edit tests. Implement now; do not just give advice.')
verified = False
for _ in range(6):
    pending = None
    for event in events:
        print(json.dumps(event), flush=True)
        if event['event'] == 'approval':
            pending = event['data']
        if event['event'] == 'tool_result' and event['data']['tool_name'] == 'run_command':
            verified = event['data']['status'] == 'ready' and event['data']['result']['exit_code'] == 0
    if not pending:
        break
    args = pending['arguments']
    if pending['tool'] == 'write_file' and args['path'] == 'calculator.py':
        assert ast.dump(ast.parse(args['content'])) == expected, 'Unexpected edit needs manual review'
    elif pending['tool'] == 'run_command' and args['argv'] in [['python3','-m','unittest','-v'], ['python3','-m','unittest']]:
        pass
    else:
        raise RuntimeError('Unexpected action needs manual review')
    decision, continuation = registry.decide(pending['id'], True)
    events = run(router, continuation=continuation, decision=decision)
assert ast.dump(ast.parse((root / 'calculator.py').read_text())) == expected
assert verified, 'Agent did not verify the change'
print('PASS: local model read, edited, and verified the fixture.', flush=True)
