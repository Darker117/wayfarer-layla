"""Private stdio adapter. Only the gateway supplies calls; never HTTP exposed."""
import asyncio
import json
import sys
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    params = StdioServerParameters(command=sys.executable, args=['-m', 'comfy_mcp.server'], env={**os.environ, 'COMFY_BIN': os.path.join(os.path.dirname(sys.executable), 'comfy.exe'), 'COMFYUI_URL': 'http://127.0.0.1:8188', 'COMFYUI_HOST': '127.0.0.1'})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            while line := await asyncio.to_thread(sys.stdin.readline):
                request = json.loads(line)
                try:
                    if request['name'] not in ('server_info', 'validate_workflow', 'run_workflow'):
                        raise ValueError('Tool not allowed')
                    result = await session.call_tool(request['name'], request.get('args', {}))
                    if result.model_dump(by_alias=True).get('isError'):
                        raise ValueError('Comfy MCP rejected the operation. Check local ComfyUI diagnostics.')
                    texts = [c.text for c in result.content if c.type == 'text']
                    value = json.loads(texts[0]) if texts else {}
                    print(json.dumps({'id': request['id'], 'result': value}), flush=True)
                except Exception:
                    print(json.dumps({'id': request['id'], 'error': 'Comfy MCP operation failed; check models, nodes and local ComfyUI.'}), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
