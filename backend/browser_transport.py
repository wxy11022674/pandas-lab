"""In-process endpoint adapter for Pyodide. No HTTP server or user-code eval.

The existing endpoint functions and pandas interpreter are shared verbatim with
the server build. Only routing, upload bytes and downloadable responses differ.
"""
import base64
import inspect
import json
import re
from pathlib import Path
from typing import get_type_hints
from urllib.parse import urlsplit, parse_qs, unquote
from pydantic import BaseModel, TypeAdapter, ValidationError


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


RequestValidationError = ValidationError


class Parameter:
    def __init__(self, default):
        self.default = default


def File(default): return Parameter(default)
def Form(default): return Parameter(default)
def Body(default): return Parameter(default)


class UploadFile:
    def __init__(self, filename, data):
        self.filename, self.data = filename, data

    async def read(self, size=-1):
        return self.data if size < 0 else self.data[:size]


class Response:
    def __init__(self, content, media_type='application/octet-stream', headers=None, status_code=200):
        self.body = content.encode('utf-8') if isinstance(content, str) else content
        self.media_type, self.headers, self.status_code = media_type, headers or {}, status_code


class JSONResponse(Response):
    def __init__(self, content, status_code=200):
        super().__init__(json.dumps(content), 'application/json', status_code=status_code)


class FileResponse(Response):
    def __init__(self, path, filename):
        super().__init__(Path(path).read_bytes(), headers={'Content-Disposition': f'attachment; filename="{filename}"'})


class StaticFiles:
    def __init__(self, **kwargs): pass


class FastAPI:
    def __init__(self, **kwargs):
        self.routes = []

    def route(self, method, path):
        pattern = re.compile('^' + re.sub(r'\{(\w+)\}', r'(?P<\1>[^/]+)', re.escape(path).replace(r'\{', '{').replace(r'\}', '}')) + '$')
        def register(function):
            self.routes.append((method, pattern, function))
            return function
        return register

    def get(self, path): return self.route('GET', path)
    def post(self, path): return self.route('POST', path)
    def middleware(self, *args): return lambda fn: fn
    def exception_handler(self, *args): return lambda fn: fn
    def mount(self, *args, **kwargs): pass

    async def dispatch(self, request):
        parsed = urlsplit('/api' + request['url'])
        query = {k: v[-1] for k, v in parse_qs(parsed.query).items()}
        method, body = request.get('method', 'GET'), request.get('body')
        try:
            for verb, pattern, function in self.routes:
                match = pattern.fullmatch(parsed.path)
                if verb != method or not match:
                    continue
                params = {k: unquote(v) for k, v in match.groupdict().items()}
                hints = get_type_hints(function)
                kwargs = {}
                for name, param in inspect.signature(function).parameters.items():
                    annotation = hints.get(name)
                    default = param.default.default if isinstance(param.default, Parameter) else param.default
                    if annotation is UploadFile:
                        file = request['file']
                        kwargs[name] = UploadFile(file['filename'], base64.b64decode(file['data']))
                    elif inspect.isclass(annotation) and issubclass(annotation, BaseModel):
                        kwargs[name] = annotation.model_validate(body)
                    elif name in params or name in query:
                        kwargs[name] = TypeAdapter(annotation or str).validate_python(params.get(name, query.get(name)))
                    elif annotation is dict and method == 'POST':
                        kwargs[name] = TypeAdapter(dict).validate_python(body)
                    elif request.get('form') and name in request['form']:
                        kwargs[name] = request['form'][name]
                    elif default is not inspect.Parameter.empty and default is not Ellipsis:
                        kwargs[name] = default
                    else:
                        raise ValueError('Missing parameter')
                result = function(**kwargs)
                if inspect.isawaitable(result):
                    result = await result
                if isinstance(result, Response):
                    filename = re.search(r'filename="([^"]+)"', result.headers.get('Content-Disposition', ''))
                    return json.dumps({'status': result.status_code, 'binary': base64.b64encode(result.body).decode(),
                                       'mediaType': result.media_type, 'filename': filename[1] if filename else parsed.path.rsplit('/', 1)[-1]})
                return json.dumps({'status': 200, 'data': result}, ensure_ascii=False, allow_nan=False)
            raise HTTPException(404, {'code': 'NOT_FOUND'})
        except HTTPException as error:
            return json.dumps({'status': error.status_code, 'error': error.detail.get('code', 'INVALID_VALUE')})
        except (ValidationError, ValueError, TypeError, KeyError):
            return json.dumps({'status': 422, 'error': 'INVALID_VALUE'})
