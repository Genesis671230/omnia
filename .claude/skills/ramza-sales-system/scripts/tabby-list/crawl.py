import re, json, sys, urllib.request, ssl
from urllib.parse import urlparse, urljoin
from concurrent.futures import ThreadPoolExecutor
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
src,out=sys.argv[1],sys.argv[2]
rows=json.load(open(src))
SKIP=re.compile(r'travel|tour|holiday|airline|air arabia|flydubai|school|clinic|dental|medical|hospital|academy|university|bank|insurance|telecom|etisalat|\bdu\b|almosafer|almatar|makemytrip|visa|real estate|properties|car rental|rent a car|driving|salon|spa\b|hammam|restaurant|cafe|hotel|garage|tyre|marine|auto parts|school|nursery|gym|fitness club|education|institute|course',re.I)
BIG=set("nike adidas huawei emax apple centrepoint honor samsung ikea sharaf noon namshi 6thstreet ounass amazon h&m zara max carrefour lulu bloomingdale level shoes sephora faces boots mumzworld noon".split())
def get(u):
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA,"Accept-Language":"en"}),timeout=12,context=ctx)
        return r.geturl(), r.read(1_500_000).decode('utf-8','ignore')
    except Exception as e: return None,""
def uniq(xs): 
    o=[]; [o.append(x) for x in xs if x not in o]; return o
BADMAIL=re.compile(r'\.(png|jpg|jpeg|gif|webp|svg)$|example|sentry|wixpress|domain\.com|email\.com|yourname|@2x',re.I)
def probe(r):
    link=r["link"]; host=urlparse(link).netloc.lower()
    if not host or any(h in host for h in ["instagram.com","facebook.com","wa.me","linktr","tiktok.com"]): return {**r,"skip":"no-own-site"}
    final,h=get(link)
    if not h: return {**r,"skip":"unreachable"}
    pages=[h]
    for path in ["/pages/contact","/pages/contact-us","/contact","/contact-us"]:
        f2,h2=get(urljoin(final,path))
        if h2 and len(h2)>2000: pages.append(h2); break
    H="\n".join(pages)
    emails=uniq([e.lower() for e in re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,6}',H) if not BADMAIL.search(e)])[:4]
    soc=lambda pat: uniq([m.rstrip('/\\"') for m in re.findall(pat,H,re.I)])[:1]
    ig=[u for u in soc(r'https?://(?:www\.)?instagram\.com/[A-Za-z0-9_.]+') if not re.search(r'instagram\.com/(p|explore|tabby|shopify)$',u)]
    d={**r,"final":final,
       "platform":"Shopify" if "cdn.shopify.com" in H or "Shopify.theme" in H else "WooCommerce" if "woocommerce" in H.lower() else "Salla" if "salla" in H.lower() else "Zid" if "zid.store" in H else "Magento" if "Magento" in H or "mage/" in H else "Custom/other",
       "tamara":"tamara" in H.lower(), "tabby_on_site":"tabby" in H.lower(),
       "cod":bool(re.search(r'cash on delivery|\bCOD\b',H,re.I)),
       "stripe":"js.stripe.com" in H or "stripe" in H.lower() and "checkout" in H.lower(),
       "shop_pay":"shop_pay" in H or "shopify_payments" in H,
       "ksa":bool(re.search(r'saudi|\bKSA\b|riyadh|jeddah|/ar-sa|en-sa',H,re.I)),
       "gcc":bool(re.search(r'kuwait|qatar|bahrain|oman',H,re.I)),
       "email":", ".join(emails),
       "instagram":", ".join(ig),
       "tiktok":", ".join(soc(r'https?://(?:www\.)?tiktok\.com/@[A-Za-z0-9_.]+')),
       "facebook":", ".join([u for u in soc(r'https?://(?:www\.)?facebook\.com/[A-Za-z0-9_.-]+') if not re.search(r'facebook\.com/(tr|sharer|plugins|dialog)',u)]),
       "linkedin":", ".join(soc(r'https?://(?:[a-z]+\.)?linkedin\.com/company/[A-Za-z0-9_.-]+')),
       "whatsapp":", ".join(uniq(re.findall(r'(?:wa\.me/|api\.whatsapp\.com/send\?phone=)(\+?\d{9,15})',H))[:1]),
       "phone":", ".join(uniq(re.findall(r'(?:\+971|00971)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}',H))[:1]),
       "products":len(re.findall(r'/products/',h)),
       "title_tag":(re.search(r'<title[^>]*>(.*?)</title>',h,re.S|re.I) or [None,""])[1].strip()[:120],
       "desc":(re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)',h,re.I) or [None,""])[1][:200]}
    return d
cands=[r for r in rows if r["storeType"]!="inStore" and not SKIP.search(r["title"]) and r["title"].strip().lower() not in BIG]
print(len(rows),"->",len(cands),file=sys.stderr)
with ThreadPoolExecutor(24) as ex: res=list(ex.map(probe,cands))
json.dump(res,open(out,'w'),indent=0)
ok=[x for x in res if not x.get("skip")]
print("reachable",len(ok),"shopify",sum(x["platform"]=="Shopify" for x in ok),"tamara",sum(x["tamara"] for x in ok),"email",sum(bool(x["email"]) for x in ok),"ig",sum(bool(x["instagram"]) for x in ok))
