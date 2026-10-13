"""Build-time local translation seed. Not shipped or invoked by the launcher."""
import json, pathlib, re, sys, time, os
import ctranslate2, sentencepiece as spm
sys.stdout.reconfigure(encoding="utf-8")
root=pathlib.Path(__file__).resolve().parent.parent
folder=root/"src/locales/messages"
registry=[dict(zip(["code","nativeName","englishName","modelCode","region"],row)) for row in re.findall(r'\["([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)"\]',(root/"src/locales/registry.ts").read_text(encoding="utf-8"))]
model=root/".tools/i18n-model/nllb"
tokenizer=spm.SentencePieceProcessor(model_file=str(model/"sentencepiece.bpe.model"))
device=os.environ.get("AURUM_TRANSLATION_DEVICE","cpu")
translator=ctranslate2.Translator(str(model),device=device,compute_type="int8_float16" if device=="cuda" else "int8",inter_threads=1,intra_threads=8)
def translate(texts,source,target):
    sources=[[source]+tokenizer.encode(t,out_type=str)+["</s>"] for t in texts]
    results=translator.translate_batch(sources,target_prefix=[[target]]*len(texts),beam_size=2,max_batch_size=32,max_decoding_length=240)
    return [tokenizer.decode(r.hypotheses[0][1:]).strip() for r in results]
def pack(original,source,target):
    keys=list(original); texts=[]; marks=[]
    for key in keys:
        text=original[key]
        placeholders=re.findall(r"\{\{[^}]+\}\}",text)
        for i,p in enumerate(placeholders):text=text.replace(p,f"[AURUM{i+1}]",1)
        texts.append(text.strip());marks.append(placeholders)
    translated=translate(texts,source,target);out={};broken=[]
    for key,text,placeholders in zip(keys,translated,marks):
        for i,p in enumerate(placeholders):text=re.sub(rf"\[\s*AURUM\s*{i+1}\s*\]",lambda _:p,text,flags=re.I)
        if sorted(re.findall(r"\{\{[^}]+\}\}",text))!=sorted(placeholders):broken.append(key)
        out[key]=re.match(r"^\s*",key)[0]+text+re.search(r"\s*$",key)[0]
    # Preserve placeholders even where the translation model rewrites the marker.
    fragments=[];layout={}
    for key in broken:
        pieces=re.split(r"(\{\{[^}]+\}\})",original[key]);layout[key]=[]
        for piece in pieces:
            if not piece or piece.startswith("{{"):layout[key].append(piece)
            else:
                layout[key].append((len(fragments),re.match(r"^\s*",piece)[0],re.search(r"\s*$",piece)[0]));fragments.append(piece.strip())
    replacements=translate(fragments,source,target) if fragments else []
    for key,pieces in layout.items():out[key]="".join(replacements[p[0]].strip().join([p[1],p[2]]) if isinstance(p,tuple) else p for p in pieces)
    for key,value in out.items():
        if sorted(re.findall(r"\{\{[^}]+\}\}",original[key]))!=sorted(re.findall(r"\{\{[^}]+\}\}",value)):raise ValueError(key)
    return out
if sys.argv[1]=="extra":
    extra=json.loads((root/".test-data/i18n/extra.json").read_text(encoding="utf-8"))
    seed=pack(extra,"rus_Cyrl","eng_Latn")
    fixes=json.loads((root/".test-data/i18n/extra-en.json").read_text(encoding="utf-8"))
    seed.update(fixes)
    english=json.loads((folder/"en.json").read_text(encoding="utf-8"));english.update(seed)
    (folder/"en.json").write_text(json.dumps(english,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for language in registry:
        if language["code"] in ["ru","en"]:continue
        target=folder/(language["code"]+".json")
        out=json.loads(target.read_text(encoding="utf-8"));out.update(pack(seed,"eng_Latn",language["modelCode"]))
        target.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print("extra",language["code"],flush=True)
    sys.exit(0)
if sys.argv[1]=="english":
    source=json.loads((folder/"ru.json").read_text(encoding="utf-8"));start=time.time();out=pack(source,"rus_Cyrl","eng_Latn")
    (folder/"en.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8");print("ENGLISH",len(out),round(time.time()-start,1),flush=True)
else:
    source=json.loads((folder/"en.json").read_text(encoding="utf-8"))
    for language in registry:
        if language["code"] in ["ru","en"]:continue
        target=folder/(language["code"]+".json")
        if target.exists():continue
        start=time.time();out=pack(source,"eng_Latn",language["modelCode"])
        target.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(language["code"],len(out),round(time.time()-start,1),flush=True)
