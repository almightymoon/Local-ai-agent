# Simple test harness to exercise WS partials/final flow
import asyncio
import json
import websockets
import sys

async def run():
    uri = "ws://127.0.0.1:8000/api/voice/session/testconv?token="
    # fetch token
    import httpx
    token = httpx.get("http://127.0.0.1:8000/api/session").json().get("token")
    uri = uri + token
    async with websockets.connect(uri) as ws:
        ready = await ws.recv()
        print('ready', ready)
        await ws.send(json.dumps({"event": "voice.start"}))
        # send some fake audio bytes as binary frames
        for i in range(5):
            await ws.send(b"\x00\x01\x02" * 1000)
            await asyncio.sleep(0.5)
        await ws.send(json.dumps({"event": "voice.stop"}))
        while True:
            msg = await ws.recv()
            print('recv', msg)
            if isinstance(msg, str) and 'stt.final' in msg:
                break

if __name__ == '__main__':
    asyncio.run(run())
