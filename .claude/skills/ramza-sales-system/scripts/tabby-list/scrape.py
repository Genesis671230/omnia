import re, json, sys, urllib.request, time
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
out=sys.argv[1]; first=int(sys.argv[2]); last=int(sys.argv[3])
rows={}
for p in range(first,last+1):
    req=urllib.request.Request(f"https://tabby.ai/en-AE/shop/stores?page={p}",headers={"User-Agent":UA})
    s=urllib.request.urlopen(req,timeout=30).read().decode()
    chunks=re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)',s,re.S)
    t=''.join(c.encode().decode('unicode_escape','ignore') for c in chunks)
    n=0
    for m in re.finditer(r'\{"id":"[0-9a-f-]{36}","slug":"([^"]+)","title":"([^"]*)","logoUrl":"[^"]*","link":"([^"]*)","showBadge":\w+,"storeType":\[([^\]]*)\]',t):
        slug,title,link,st=m.groups()
        if slug not in rows: rows[slug]={"page":p,"slug":slug,"title":title,"link":link,"storeType":st.replace('"','')}; n+=1
    tp=re.findall(r'"(?:totalPages|pagesCount|pageCount)":(\d+)',t)
    print(p,n,tp[:1],file=sys.stderr)
    if n==0: break
    time.sleep(0.6)
json.dump(list(rows.values()),open(out,'w'),indent=0)
print(len(rows))
