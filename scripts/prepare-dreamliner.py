#!/usr/bin/env python3
"""Bake the GPL-2.0 FlightGear exterior into an indexed GLB for the sky tour.
Requires numpy and Pillow. Source commit is pinned; source archive accompanies
both derivatives. Simulator-only interiors, gears and duplicate blur discs are
omitted. AC3D crease angles, UVs and metre-scale coordinates are preserved.
Usage: python3 scripts/prepare-dreamliner.py --cache /tmp/dreamliner-source
"""
from pathlib import Path
import shlex, numpy as np

def read_ac(path):
 lines=iter(Path(path).read_text().splitlines()); materials=[]
 def obj(kind):
  o={'kind':kind,'children':[],'loc':[0,0,0],'rot':np.eye(3).tolist(),'texture':None,'crease':45,'vertices':[],'faces':[]}
  for line in lines:
   t=shlex.split(line)
   if not t: continue
   k=t[0]
   if k=='name': o['name']=t[1]
   elif k=='data': next(lines)
   elif k=='loc': o['loc']=list(map(float,t[1:]))
   elif k=='rot': o['rot']=np.array(list(map(float,t[1:]))).reshape(3,3).tolist()
   elif k=='crease': o[k]=float(t[1])
   elif k=='texture': o[k]=t[1]
   elif k=='numvert': o['vertices']=[list(map(float,next(lines).split())) for _ in range(int(t[1]))]
   elif k=='numsurf':
    for _ in range(int(t[1])):
     typ=next(lines).split(); assert typ[0]=='SURF',typ
     mat=next(lines).split(); assert mat[0]=='mat',mat
     refs=next(lines).split(); assert refs[0]=='refs',refs
     r=[list(map(float,next(lines).split())) for _ in range(int(refs[1]))]
     o['faces'].append({'flags':int(typ[1],0),'material':int(mat[1]),'refs':r})
   elif k=='kids':
    for _ in range(int(t[1])):
     header=next(lines).split(); assert header[0]=='OBJECT',header
     o['children'].append(obj(header[1]))
    return o
  raise ValueError('No kids')
 for line in lines:
  if line.startswith('MATERIAL'): materials.append(shlex.split(line))
  if line.startswith('OBJECT'): return obj(line.split()[1]),materials

import argparse, json, struct, math, io, zipfile, urllib.request
from collections import defaultdict
from PIL import Image
COMMIT = '02626b5b659d89b9399943ee167bbb0b46f0c871'
SOURCE = 'https://github.com/IskenderWang/787-family/tree/' + COMMIT
FILES = ['LICENSE','Authors.md','Models/787-9.ac','Models/787-9.blend','Models/787-9-GEnx.xml','Models/animation-common.xml','Models/GEnx.ac','Models/GEnx.xml','Models/787-9.png','Models/GEnx.png','Models/wings.png']

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--cache',type=Path,required=True);ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);args=ap.parse_args()
 for f in FILES:
  p=args.cache/f
  if not p.exists():
   p.parent.mkdir(parents=True,exist_ok=True)
   p.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/IskenderWang/787-family/'+COMMIT+'/'+f).read())
 groups=defaultdict(lambda:{'p':[],'n':[],'uv':[],'idx':[],'lookup':{}})
 omitted=[]
 def group_for(o,engine):
  n=o.get('name','');tex=o['texture']
  if engine:
   if n in ['eng1fan1','eng2fan1','lhfans','rhfans','wing']: return None
   if n.startswith('eng1'):return 'fan-port'
   if n.startswith('eng2'):return 'fan-starboard'
   if n in ['no1enge','no2enge','lhreverser','rhreverser']:return 'nacelle'
   if n in ['front','no1pylon','no2pylon']: return 'inlet'
   return 'engine-interior'
  if tex=='landing-gears.png' or n in ['gearbay','windows-bright','windows-dim','wifiantenna']:return None
  if n=='Window':return 'glass'
  if tex in ['787-9.png','787-10.png']: return 'skin'
  if tex=='wings.png':return 'wing-metal'
  if n.startswith(('lbeacon','ubeacon')):return 'beacon'
  if 'wiper' in n:return 'glass'
  return 'chrome'
 def visit(o,engine,rot=None,loc=None):
  rot=np.eye(3) if rot is None else rot;loc=np.zeros(3) if loc is None else loc
  loc=loc+rot@np.array(o['loc']);rot=rot@np.array(o['rot'])
  if o['vertices']:
   g=group_for(o,engine)
   if g is None: omitted.append(o.get('name'))
   else:
    points=np.array(o['vertices'])@rot.T+loc
    faces=[f for f in o['faces'] if len(f['refs'])>=3 and (f['flags']&15)==0]
    normals=[]; neighbours=defaultdict(list)
    for fi,f in enumerate(faces):
     ids=[int(r[0]) for r in f['refs']]; v=points[ids]
     normal=np.cross(v,np.roll(v,-1,axis=0)).sum(axis=0)
     length=np.linalg.norm(normal);normal=normal/max(1e-12,length)
     normals.append(normal)
     for vi in set(ids):neighbours[vi].append(fi)
    normals=np.array(normals);threshold=math.cos(math.radians(o['crease']))
    out=groups[g]
    for fi,f in enumerate(faces):
     corners=[]
     for r in f['refs']:
      vi=int(r[0]);n=normals[fi]
      if f['flags']&16:
       adjacent=normals[neighbours[vi]];good=adjacent[(adjacent@n)>threshold-1e-5]
       n=good.sum(axis=0);n=n/max(1e-12,np.linalg.norm(n))
      p=points[vi];uv=[r[1],1-r[2]]
      key=tuple(round(float(x),6) for x in [*p,*n,*uv])
      idx=out['lookup'].get(key)
      if idx is None:
       idx=len(out['p']);out['lookup'][key]=idx;out['p'].append(p.tolist());out['n'].append(n.tolist());out['uv'].append(uv)
      corners.append(idx)
     for i in range(1,len(corners)-1):out['idx'].extend([corners[0],corners[i],corners[i+1]])
  for c in o['children']:visit(c,engine,rot,loc)
 for filename,engine in [('787-9.ac',False),('GEnx.ac',True)]:
  root,_=read_ac(args.cache/'Models'/filename);visit(root,engine)
 gltf={'asset':{'version':'2.0','generator':'prepare-dreamliner.py','copyright':'FlightGear 787-family contributors; GPL-2.0; see /credits/dreamliner.html'},'extras':{'source':SOURCE,'license':'GPL-2.0','modifications':'Exterior-only cruise pose, blank livery, indexed/merged geometry, WebP encoding. Original coordinates retained.'},'scenes':[{'nodes':[]}],'scene':0,'nodes':[],'meshes':[],'materials':[],'textures':[],'images':[],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],'accessors':[],'bufferViews':[],'buffers':[],'extensionsUsed':['EXT_texture_webp'],'extensionsRequired':['EXT_texture_webp']}
 binary=bytearray()
 def view(data,target=None):
  while len(binary)%4:binary.append(0)
  offset=len(binary);binary.extend(data);v={'buffer':0,'byteOffset':offset,'byteLength':len(data)}
  if target:v['target']=target
  gltf['bufferViews'].append(v);return len(gltf['bufferViews'])-1
 def attr(data,typ,component=5126):
  a=np.array(data,dtype='<f4' if component==5126 else '<u4');v=view(a.tobytes(),34963 if component==5125 else 34962)
  info={'bufferView':v,'componentType':component,'count':len(data),'type':typ}
  if typ=='VEC3':info.update(min=a.min(0).tolist(),max=a.max(0).tolist())
  gltf['accessors'].append(info);return len(gltf['accessors'])-1
 for f in ['787-9.png','GEnx.png','wings.png']:
  image=Image.open(args.cache/'Models'/f).convert('RGB');image.thumbnail((4096,4096),Image.Resampling.LANCZOS);encoded=io.BytesIO();image.save(encoded,format='WEBP',quality=94,method=6)
  gltf['images'].append({'bufferView':view(encoded.getvalue()),'mimeType':'image/webp','name':f})
  gltf['textures'].append({'sampler':0,'extensions':{'EXT_texture_webp':{'source':len(gltf['images'])-1}}})
 for name,o in groups.items():
  tex=0 if name=='skin' else 2 if name=='wing-metal' else 1 if name in ['nacelle','inlet','engine-interior','fan-port','fan-starboard'] else None
  pbr={'roughnessFactor':0.32,'metallicFactor':0.18}
  if tex is not None:pbr['baseColorTexture']={'index':tex}
  if name=='glass':pbr.update(baseColorFactor=[0.015,0.025,0.038,1],metallicFactor=.45,roughnessFactor=.16)
  if name=='chrome':pbr.update(metallicFactor=.8,roughnessFactor=.24)
  if name=='beacon':pbr.update(baseColorFactor=[.7,.016,.009,1])
  gltf['materials'].append({'name':name,'doubleSided':True,'pbrMetallicRoughness':pbr})
  gltf['meshes'].append({'name':name,'primitives':[{'attributes':{'POSITION':attr(o['p'],'VEC3'),'NORMAL':attr(o['n'],'VEC3'),'TEXCOORD_0':attr(o['uv'],'VEC2')},'indices':attr(o['idx'],'SCALAR',5125),'material':len(gltf['materials'])-1}]})
  gltf['nodes'].append({'name':name,'mesh':len(gltf['meshes'])-1});gltf['scenes'][0]['nodes'].append(len(gltf['nodes'])-1)
  print(name,len(o['p']),'vertices',len(o['idx'])//3,'triangles')
 while len(binary)%4:binary.append(0)
 gltf['buffers']=[{'byteLength':len(binary)}];meta=json.dumps(gltf,separators=(',',':')).encode();meta+=b' '*((-len(meta))%4)
 target=args.root/'public/models/dreamliner-787-9.glb';target.parent.mkdir(parents=True,exist_ok=True)
 target.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(meta)+len(binary))+struct.pack('<II',len(meta),0x4E4F534A)+meta+struct.pack('<II',len(binary),0x004E4942)+binary)
 source=args.root/'public/credits/dreamliner-source.zip';source.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for f in FILES:z.write(args.cache/f,f)
  z.write(__file__,'prepare-dreamliner.py')
  z.writestr('MODIFICATIONS.txt','Source: '+SOURCE+'\nGPL-2.0; original assets by the authors in Authors.md.\nThe script converts AC3D to merged GLB. Gear/interior compressor stacks and duplicate blur discs are omitted for the cruise pose. Texture images are transcoded to WebP. Geometry and UVs retain source coordinates. The .blend and .ac files are the editable source. Requires Python, numpy, Pillow.\n')
 print('GLB',target.stat().st_size,'bytes; source',source.stat().st_size,'bytes; omitted',len(omitted),'simulator meshes')

if __name__=='__main__':main()
