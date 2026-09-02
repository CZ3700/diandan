# 复现命令与公开来源

以下命令均为无登录只读请求。时间敏感结果（DNS、证书、页面版本、Lighthouse）会变化。

## HTTP 与重定向

```bash
curl -sSIL https://mxcheer.com
curl -sSIL http://sonnystargroup.com
curl -sSIL https://sonnystargroup.com
curl -sS -D - -o /dev/null https://www.sonnystargroup.com
```

## DNS 与 RDAP

```bash
curl -sS 'https://dns.google/resolve?name=mxcheer.com&type=A' | jq .
curl -sS 'https://dns.google/resolve?name=sonnystargroup.com&type=A' | jq .
curl -sS 'https://rdap.verisign.com/com/v1/domain/MXCHEER.COM' | jq .
curl -sS 'https://rdap.verisign.com/com/v1/domain/SONNYSTARGROUP.COM' | jq .
curl -sS 'https://rdap.verisign.com/com/v1/domain/VIVIDLIVESTAR.COM' | jq .
```

## TLS

```bash
openssl s_client -connect mxcheer.com:443 -servername mxcheer.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName

openssl s_client -connect sonnystargroup.com:443 -servername sonnystargroup.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

## 公开站点文件与 WordPress/Shopify 数据

```bash
curl -sSL https://mxcheer.com/robots.txt
curl -sSL https://mxcheer.com/wp-json/ | jq '{name,namespaces,routes_count:(.routes|length)}'
curl -sS 'https://mxcheer.com/wp-json/wc/store/v1/products?per_page=100' | jq 'length'

curl -sSL https://sonnystargroup.com/robots.txt
curl -sSL https://sonnystargroup.com/

curl -sSL 'https://vividlivestar.com/products.json?limit=250' | jq '.products|length'
curl -sSL 'https://vividlivestar.com/collections.json?limit=250' | jq '.collections|length'
```

## Lighthouse lab

```bash
npx --yes lighthouse 'https://mxcheer.com' \
  --chrome-path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --chrome-flags='--headless=new --no-sandbox' \
  --output=json --output-path=/tmp/lighthouse-mx.json --quiet \
  --only-categories=performance,seo,best-practices,accessibility

npx --yes lighthouse 'https://sonnystargroup.com' \
  --chrome-path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --chrome-flags='--headless=new --no-sandbox' \
  --output=json --output-path=/tmp/lighthouse-sonny.json --quiet \
  --only-categories=performance,seo,best-practices,accessibility
```

## 公开链接

- [mxcheer](https://mxcheer.com/)
- [mxcheer robots.txt](https://mxcheer.com/robots.txt)
- [mxcheer WordPress REST index](https://mxcheer.com/wp-json/)
- [mxcheer Woo Store API products](https://mxcheer.com/wp-json/wc/store/v1/products?per_page=100)
- [Sonny Star Group](https://sonnystargroup.com/)
- [Sonny robots.txt](https://sonnystargroup.com/robots.txt)
- [Vivid Live Star](https://vividlivestar.com/)
- [Vivid public products JSON](https://vividlivestar.com/products.json?limit=250)
- [Vivid public collections JSON](https://vividlivestar.com/collections.json?limit=250)
- [Google DNS-over-HTTPS](https://developers.google.com/speed/public-dns/docs/doh)
- [Verisign RDAP](https://www.verisign.com/en_US/channel-resources/domain-registry-products/registration-data-access-protocol/index.xhtml)

注：PageSpeed Insights API 本次返回 429/项目日配额为 0，因此性能结论使用本地 Lighthouse 单次 lab 快照，不声称是真实用户 field data。
