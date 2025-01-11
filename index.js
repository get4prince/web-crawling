const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const fs = require('fs').promises;

class CrawlerConfig {
    constructor({
        maxConcurrentRequests = 10,
        requestTimeout = 30000,
        maxRetries = 3,
        productPatterns = null
    } = {}) {
        this.maxConcurrentRequests = maxConcurrentRequests;
        this.requestTimeout = requestTimeout;
        this.maxRetries = maxRetries;
        this.productPatterns = productPatterns || [
            /\/product(s)?(\/?)/i,  
            /\/item(s)?(\/?)/i,
            /\/p\//i,
            /\/pd\//i,
            /\/catalog\//i,
            /\-i\-/i,
            /\/dp\//i
        ];
    }
}


class EcommerceCrawler {
    constructor(config = new CrawlerConfig()) {
        this.config = config;
        this.visitedUrls = new Set();
        this.productUrls = new Map();
        this.axiosInstance = axios.create({
            timeout: this.config.requestTimeout
        });
    }


    isProductUrl(url) {
        return this.config.productPatterns.some(pattern => pattern.test(url));
    }


    async fetchUrl(url, retryCount = 0) {
        try {
            const response = await this.axiosInstance.get(url);
            return response.data;
        } catch (error) {
            if (error.response?.status === 429 && retryCount < this.config.maxRetries) {
                const retryAfter = parseInt(error.response.headers['retry-after'] || '5');
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return this.fetchUrl(url, retryCount + 1);
            }


            if (retryCount < this.config.maxRetries) {
                await new Promise(resolve =>
                    setTimeout(resolve, Math.pow(2, retryCount) * 1000)
                );
                return this.fetchUrl(url, retryCount + 1);
            }


            console.error(`Error fetching ${url}:`, error.message);
            return null;
        }
    }


    extractUrls(html, baseUrl) {
        const urls = new Set();
        try {
            const $ = cheerio.load(html);
            const baseUrlObj = new URL(baseUrl);


            $('a[href]').each((_, element) => {
                const href = $(element).attr('href');
                try {  
                    const absoluteUrl = new URL(href, baseUrl);
                    if (absoluteUrl.hostname === baseUrlObj.hostname) {
                        urls.add(absoluteUrl.href);
                    }
                } catch (error) {
                    // Invalid URL - skip
                }
            });
        } catch (error) {
            console.error(`Error parsing HTML from ${baseUrl}:`, error.message);
        }
        return urls;
    }


    async processBatch(urls) {
        const results = await Promise.all(
            urls.map(async url => {
                const html = await this.fetchUrl(url);
                return { url, html };
            })
        );
        return results.filter(result => result.html !== null);
    }


    async crawlSite(domain) {
        if (!domain.startsWith('http')) {
            domain = `https://${domain}`;
        }


        this.productUrls.set(domain, new Set());
        const queue = [domain];


        while (queue.length > 0) {
            const batch = queue.splice(0, this.config.maxConcurrentRequests);
            const results = await this.processBatch(batch);


            for (const { url, html } of results) {
                if (this.isProductUrl(url)) {
                    this.productUrls.get(domain).add(url);
                }


                const newUrls = this.extractUrls(html, url);
                for (const newUrl of newUrls) {
                    if (!this.visitedUrls.has(newUrl)) {
                        this.visitedUrls.add(newUrl);
                        queue.push(newUrl);
                    }
                }
            }
        }
    }


    async crawlSites(domains) {
        const startTime = Date.now();


        const chunkSize = this.config.maxConcurrentRequests;
        for (let i = 0; i < domains.length; i += chunkSize) {
            const chunk = domains.slice(i, i + chunkSize);
            await Promise.all(chunk.map(domain => this.crawlSite(domain)));
        }


        const duration = (Date.now() - startTime) / 1000;
        console.log(`\nCrawling completed in ${duration.toFixed(2)} seconds`);


        for (const [domain, urls] of this.productUrls.entries()) {
            console.log(`\n${domain}: Found ${urls.size} product URLs`);
        }


        return Object.fromEntries(
            Array.from(this.productUrls.entries()).map(
                ([domain, urls]) => [domain, Array.from(urls)]
            )
        );
    }


    async saveResults(filename = 'product_urls.json') {
        const results = Object.fromEntries(
            Array.from(this.productUrls.entries()).map(
                ([domain, urls]) => [domain, Array.from(urls)]
            )
        );
        await fs.writeFile(filename, JSON.stringify(results, null, 2));
    }
}


async function main() {
    const config = new CrawlerConfig({
        maxConcurrentRequests: 100,
        requestTimeout: 30000,
        maxRetries: 3
    });


    const crawler = new EcommerceCrawler(config);
    const domains = [
        'flipkart.com',
        'amazon.in'
    ];


    setInterval(async () => {
        console.log("interval running")
        const formatMemoryUsage = (data) => `${Math.round(data / 1024 / 1024 * 100) / 100} MB`;

        const memoryData = process.memoryUsage();

        const memoryUsage = {
            rss: `${formatMemoryUsage(memoryData.rss)} -> Resident Set Size - total memory allocated for the process execution`,
            heapTotal: `${formatMemoryUsage(memoryData.heapTotal)} -> total size of the allocated heap`,
            heapUsed: `${formatMemoryUsage(memoryData.heapUsed)} -> actual memory used during the execution`,
            external: `${formatMemoryUsage(memoryData.external)} -> V8 external memory`,
        };
        console.log(memoryUsage);

        await crawler.saveResults();
    }, 5000)


    try {
        const results = await crawler.crawlSites(domains);
        await crawler.saveResults();
        return results;
    } catch (error) {
        console.error('Crawling failed:', error);
        throw error;
    }
}


module.exports = {
    EcommerceCrawler,
    CrawlerConfig,
    main
};


// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
