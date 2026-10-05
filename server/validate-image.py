import sys,io,json
from PIL import Image
raw=sys.stdin.buffer.read(12*1024*1024+1)
assert len(raw)<=12*1024*1024
im=Image.open(io.BytesIO(raw));assert im.format in ['PNG','JPEG','WEBP'];assert 0<im.width<=8192 and 0<im.height<=8192;im.verify()
print(json.dumps({'valid':True}))
