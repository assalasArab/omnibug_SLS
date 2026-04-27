/**
 * Generic Base Provider
 *
 * @class
 */
/* exported BaseProvider */
class BaseProvider
{
    constructor()
    {
        this._key        = "";
        this._pattern    = /.*/;
        this._name       = "";
        this._type       = "";
        this._keywords   = [];
    }

    /**
     * Get the Provider's key
     *
     * @returns {string}
     */
    get key()
    {
        return this._key;
    }

    /**
     * Get the Provider's type
     *
     * @returns {string}
     */
    get type()
    {
        let types = {
            "analytics":    "Analytics",
            "customer":     "Customer Engagement",
            "testing":      "UX Testing",
            "tagmanager":   "Tag Manager",
            "visitorid":    "Visitor Identification",
            "marketing":    "Marketing",
            "replay":       "Session Replay/Heat Maps"
        };
        return types[this._type] || "Unknown";
    }

    /**
     * Retrieve the keywords for searching
     *
     * @returns {[]}
     */
    get keywords()
    {
        return this._keywords;
    }

    /**
     * Get the Provider's RegExp pattern
     *
     * @returns {RegExp}
     */
    get pattern()
    {
        return this._pattern;
    }

    /**
     * Get the Provider's name
     *
     * @returns {string}
     */
    get name()
    {
        return this._name;
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {};
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {};
    }

    /**
     * Check if this provider should parse the given URL
     *
     * @param {string}  rawUrl   A URL to check against
     *
     * @returns {Boolean}
     */
    checkUrl(rawUrl)
    {
        return this.pattern.test(rawUrl);
    }

    /**
     * Parse a given URL into human-readable output
     *
     * @param {string}  rawUrl      A URL to check against
     * @param {string}  postData    POST data, if applicable
     *
     * @return {{provider: {name: string, key: string, type: string}, data: Array}}
     */
    parseUrl(rawUrl, postData = "")
    {
        let url = new URL(rawUrl),
            data = [],
            params = new URLSearchParams(url.search),
            postParams = this.parsePostData(postData);

        // Handle POST data first, if applicable (treat as query params)
        postParams.forEach((pair) => {
            params.append(pair[0], pair[1]);
        });

        for(let param of params)
        {
            let key = param[0],
                value = param[1],
                result = this.handleQueryParam(key, value);
            if(typeof result === "object") {
                data.push(result);
            }
        }

        let customData = this.handleCustom(url, params);
        if(typeof customData === "object" && customData !== null)
        {
            if(customData.length) {
                data = data.concat(customData);
            } else {
                data.push(customData);
            }
        }

        return {
            "provider": {
                "name":    this.name,
                "key":     this.key,
                "type":    this.type,
                "columns": this.columnMapping,
                "groups":  this.groups
            },
            "data": data
        };
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "")
    {
        let params = [],
            parsed = {};
        if(typeof postData === "string" && postData)
        {
            try
            {
                parsed = JSON.parse(postData);
                /* Based on https://stackoverflow.com/a/19101235 */
                let recurse = (cur, prop) =>
                {
                    if (Object(cur) !== cur)
                    {
                        params.push([prop, cur]);
                    }
                    else if (Array.isArray(cur))
                    {
                        for(var i=0, l=cur.length; i<l; i++)
                        {
                            recurse(cur[i], prop + "[" + i + "]");
                        }
                        if (l === 0)
                        {
                            params.push([prop, ""]);
                        }
                    }
                    else
                    {
                        let isEmpty = true;
                        for (let p in cur)
                        {
                            if (!Object.prototype.hasOwnProperty.call(cur, p)) { continue; }
                            isEmpty = false;
                            recurse(cur[p], prop ? prop+"."+p : p);
                        }
                        if (isEmpty && prop)
                        {
                            params.push([prop, ""]);
                        }
                    }
                };
                recurse(parsed, "");
            }
            catch(e)
            {
                console.error("postData is not JSON", e.message);
            }
        }
        else if(typeof postData === "object" && postData)
        {
            // Form data type
            Object.entries(postData).forEach((entry) => {
                params.push([entry[0], entry[1].toString()]);
            });
        }
        return params;
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     * @returns {{}}
     */
    handleQueryParam(name, value)
    {
        let param = this.keys[name] || {};
        if(!param.hidden) {
            return {
                "key":   name,
                "field": param.name || name,
                "value": value,
                "group": param.group || "other"
            };
        }
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {

    }
}

/**
 * Omnibug Provider Factory
 *
 * @type {{addProvider, getProviders, checkUrl, getProviderForUrl, parseUrl, defaultPattern}}
 */
/* exported OmnibugProvider */
var OmnibugProvider = (function() {

    var providers = {},
        defaultPattern = [],
        defaultPatternRegex = new RegExp();

    /**
     * Return the provider for a specified url
     *
     * @param url
     *
     * @returns {typeof BaseProvider}
     */
    let getProviderForUrl = (url) => {
        for(let provider in providers) {
            if (Object.prototype.hasOwnProperty.call(providers, provider) && providers[provider].checkUrl(url)) {
                return providers[provider];
            }
        }
        return new BaseProvider();
    };

    return {

        /**
         * Add a new provider
         *
         * @param {typeof BaseProvider} provider
         */
        "addProvider": (provider) => {
            providers[provider.key] = provider;
            defaultPattern.push(provider.pattern);
            defaultPatternRegex = new RegExp(defaultPattern.map((el) => {
                return el.source;
            }).join("|"));
        },

        /**
         * Returns a list of all added providers
         *
         * @returns {{}}
         */
        "getProviders": () => {
            return providers;
        },

        /**
         * Checks if a URL should be parsed or not
         *
         * @param {string}  url   URL to check against
         *
         * @returns {boolean}
         */
        "checkUrl": (url) => {
            return defaultPatternRegex.test(url);
        },

        /**
         * Return the provider for a specified url
         *
         * @param url
         *
         * @returns {typeof BaseProvider}
         */
        "getProviderForUrl": getProviderForUrl,

        /**
         * Parse a URL into a JSON object
         *
         * @param {string}  url         URL to be parsed
         * @param {string}  postData    POST data, if applicable
         *
         * @returns {{provider, data}}
         */
        "parseUrl": (url, postData = "") => {
            return getProviderForUrl(url).parseUrl(url, postData);
        },

        /**
         * Return the patterns for all (enabled) providers
         *
         * @param   {void|{}}  providerInfo    Providers that are disabled
         *
         * @returns {RegExp}
         */
        "getPattern": (providerInfo = {}) => {
            let patterns = [];
            Object.keys(providers).forEach((provider) => {
                if(typeof providerInfo[provider] === "undefined" || providerInfo[provider].enabled) {
                    patterns.push(providers[provider].pattern.source);
                }
            });
            return new RegExp(patterns.join("|"), "i");
        }
    };
})();
/**
 * Adform
 * https://about.ads.microsoft.com/en-us/solutions/audience-targeting/universal-event-tracking
 *
 * @class
 * @extends BaseProvider
 */
class AdformProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "ADFORM";
        this._pattern = /track\.adform\.net\/Serving\/TrackPoint/;
        this._name = "Adform";
        this._type = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "pm"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "pm": {
                "name": "Tracking ID",
                "group": "general"
            }
        };
    }
}

/**
 * Adobe Analytics
 * http://www.adobe.com/data-analytics-cloud/analytics.html
 *
 * @class
 * @extends BaseProvider
 */
class AdobeAnalyticsProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBEANALYTICS";
        this._pattern    = /^([^#?]+)(\/b\/ss\/)|\.2o7\.net\/|\.sc\d?\.omtrdc\.net\/(?!id)/;
        this._name       = "Adobe Analytics";
        this._type       = "analytics";
        this._keywords   = ["aa", "site catalyst", "sitecatalyst", "omniture"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "rsid",
            "requestType":  "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general", 
                "name": "General"
            }, 
            {
                "key": "props",
                "name": "Custom Traffic Variables (props)"
            }, 
            {
                "key": "eVars",
                "name": "Custom Conversion Variables (eVars)"
            },
            {
                "key": "listvar",
                "name": "List Variables"
            },
            {
                "key": "hier",
                "name": "Hierarchy Variables"
            }, 
            {
                "key": "media",
                "name": "Media Module"
            }, 
            {
                "key": "activity",
                "name": "Activity Map"
            }, 
            {
                "key": "context",
                "name": "Context Data"
            },
            {
                "key": "customerid",
                "name": "Customer ID"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "ns": {
                "name": "Visitor namespace",
                "group": "general"
            },
            "ndh": {
                "name": "Image sent from JS?",
                "group": "other"
            },
            "ch": {
                "name": "Channel",
                "group": "general"
            },
            "r": {
                "name": "Referrer URL",
                "group": "general"
            },
            "ce": {
                "name": "Character set",
                "group": "general"
            },
            "cl": {
                "name": "Cookie lifetime",
                "group": "other"
            },
            "g": {
                "name": "Current URL",
                "group": "general"
            },
            "bw": {
                "name": "Browser width",
                "group": "other"
            },
            "bh": {
                "name": "Browser height",
                "group": "other"
            },
            "s": {
                "name": "Screen resolution",
                "group": "other"
            },
            "c": {
                "name": "Screen color depth",
                "group": "other"
            },
            "ct": {
                "name": "Connection type",
                "group": "other"
            },
            "p": {
                "name": "Netscape plugins",
                "group": "other"
            },
            "k": {
                "name": "Cookies enabled?",
                "group": "other"
            },
            "hp": {
                "name": "Home page?",
                "group": "other"
            },
            "pid": {
                "name": "Page ID",
                "group": "general"
            },
            "pidt": {
                "name": "Page ID type",
                "group": "general"
            },
            "oid": {
                "name": "Object ID",
                "group": "general"
            },
            "oidt": {
                "name": "Object ID type",
                "group": "general"
            },
            "ot": {
                "name": "Object tag name",
                "group": "general"
            },
            "pe": {
                "name": "Link type",
                "group": "general"
            },
            "pev1": {
                "name": "Link URL",
                "group": "general"
            },
            "pev2": {
                "name": "Link name",
                "group": "general"
            },
            "pev3": {
                "name": "Video milestone",
                "group": "general"
            },
            "cc": {
                "name": "Currency code",
                "group": "general"
            },
            "t": {
                "name": "Browser time",
                "group": "other"
            },
            "v": {
                "name": "Javascript-enabled browser?",
                "group": "other"
            },
            "pccr": {
                "name": "Prevent infinite redirects",
                "group": "other"
            },
            "vid": {
                "name": "Visitor ID",
                "group": "general"
            },
            "vidn": {
                "name": "New visitor ID",
                "group": "general"
            },
            "fid": {
                "name": "Fallback Visitor ID",
                "group": "general"
            },
            "mid": {
                "name": "Marketing Cloud Visitor ID",
                "group": "general"
            },
            "mcorgid ": {
                "name": "Marketing Cloud Org ID",
                "group": "general"
            },
            "aid": {
                "name": "Legacy Visitor ID",
                "group": "general"
            },
            "cdp": {
                "name": "Cookie domain periods",
                "group": "general"
            },
            "pageName": {
                "name": "Page name",
                "group": "general"
            },
            "pageType": {
                "name": "Page type",
                "group": "general"
            },
            "server": {
                "name": "Server",
                "group": "general"
            },
            "events": {
                "name": "Events",
                "group": "general"
            },
            "products": {
                "name": "Products",
                "group": "general"
            },
            "purchaseID": {
                "name": "Purchase ID",
                "group": "general"
            },
            "state": {
                "name": "Visitor state",
                "group": "general"
            },
            "vmk": {
                "name": "Visitor migration key",
                "group": "other"
            },
            "vvp": {
                "name": "Variable provider",
                "group": "other"
            },
            "xact": {
                "name": "Transaction ID",
                "group": "general"
            },
            "zip": {
                "name": "ZIP/Postal code",
                "group": "general"
            },
            "rsid": {
                "name": "Report Suites",
                "group": "general"
            },
            "requestType": {
                "hidden": true
            }
        };
    }

    /**
     * Parse a given URL into human-readable output
     *
     * @param {string}  rawUrl   A URL to check against
     * @param {string}  postData    POST data, if applicable
     *
     * @return {{provider: {name: string, key: string, type: string}, data: Array}}
     */
    parseUrl(rawUrl, postData = "")
    {
        let url = new URL(rawUrl),
            data = [],
            stacked = [],
            params = new URLSearchParams(url.search),
            postParams = this.parsePostData(postData);

        // Handle POST data first, if applicable (treat as query params)
        postParams.forEach((pair) => {
            params.append(pair[0], pair[1]);
        });

        for(let param of params)
        {
            let key = param[0],
                value = param[1];

            // Stack context data params
            if (/\.$/.test(key)) {
                stacked.push(key);
                continue;
            }
            if (/^\./.test(key)) {
                stacked.pop();
                continue;
            }

            let stackedParam = stacked.join("") + key,
                result = this.handleQueryParam(stackedParam, value);
            if(typeof result === "object") {
                data.push(result);
            }
        }

        data = data.concat(this.handleCustom(url, params));

        return {
            "provider": {
                "name": this.name,
                "key":  this.key,
                "type": this.type,
                "columns": this.columnMapping,
                "groups":  this.groups
            },
            "data": data
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^(?:c|prop)(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": "prop" + RegExp.$1,
                "value": value,
                "group": "props"
            };
        } else if(/^(?:v|eVar)(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": "eVar" + RegExp.$1,
                "value": value,
                "group": "eVars"
            };
        } else if(/^(?:h|hier)(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": "Hierarchy " + RegExp.$1,
                "value": value,
                "group": "hier"
            };
        } else if(/^(?:l|list)(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": "List Var " + RegExp.$1,
                "value": value,
                "group": "listvar"
            };
        } else if(name.indexOf(".a.media.") > 0) {
            result = {
                "key":   name,
                "field": name.split(".").pop(),
                "value": value,
                "group": "media"
            };
        } else if(name.indexOf(".a.activitymap.") > 0) {
            result = {
                "key":   name,
                "field": name.split(".").pop(),
                "value": value,
                "group": "activity"
            };
        } else if(name.indexOf("cid.") === 0) {
            result = {
                "key":   name,
                "field": name.replace("cid.", ""),
                "value": value,
                "group": "customerid"
            };
        } else if(name.indexOf(".") > 0) {
            result = {
                "key":   name,
                "field": name.replace("c.", ""),
                "value": value,
                "group": "context"
            };
        } else if(/^(AQB|AQE)$/i.test(name)) {
            // ignore
            return;
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "") {
        let params = [];
        // Handle POST data first, if applicable (treat as query params)
        if (typeof postData === "string" && postData !== "") {
            let keyPairs = postData.split("&");
            keyPairs.forEach((keyPair) => {
                let splitPair = keyPair.split("=");
                params.push([splitPair[0], decodeURIComponent(splitPair[1] || "")]);
            });
        } else if (typeof postData === "object") {
            Object.entries(postData).forEach((entry) => {
                // @TODO: consider handling multiple values passed?
                params.push([entry[0], entry[1].toString()]);
            });
        }
        return params;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            rsid = url.pathname.match(/\/b\/ss\/([^/]+)\//),
            jsVersion = url.pathname.match(/\/(JS-[^/]+)\//i),
            pev2 = params.get("pe"),
            requestType = "Page View";
        if(rsid) {
            results.push({
                "key":   "rsid",
                "field": this.keys.rsid ? this.keys.rsid.name : "Report Suites",
                "value": rsid[1],
                "group": this.keys.rsid ? this.keys.rsid.group : "general",
            });
        }
        if(jsVersion) {
            results.push({
                "key":   "version",
                "field": this.keys.version ? this.keys.version.name : "JavaScript Version",
                "value": jsVersion[1],
                "group": this.keys.version ? this.keys.version.group : "general",
            });
        }
        results.push({
            "key":   "trackingServer",
            "field": "Tracking Server",
            "value": url.hostname,
            "group": "general",
        });

        // Handle s.tl calls
        if(pev2 === "lnk_e") {
            requestType = "Exit Click";
        } else if(pev2 === "lnk_d") {
            requestType = "Download Click";
        } else if(pev2 === "lnk_o") {
            requestType = "Other Click";
        } else if(/^m_/.test(pev2)) {
            requestType = "Media";
        }
        results.push({
            "key":   "requestType",
            "value": requestType,
            "hidden": true
        });
        return results;
    }
}
/**
 * Adobe Audience Manager
 * http://www.adobe.com/data-analytics-cloud/audience-manager.html
 *
 * @class
 * @extends BaseProvider
 */
class AdobeAudienceManagerProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBEAUDIENCEMANAGER";
        this._pattern    = /demdex\.net\/(ibs|event)[?/#:]/;
        this._name       = "Adobe Audience Manager";
        this._type       = "visitorid";
        this._keywords   = ["aam"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "requestType": "omnibug_requestType",
            "account": "omnibug_account"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "customer",
                "name": "Customer Attributes"
            },
            {
                "key": "private",
                "name": "Private Attributes"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "caller": {
                "name": "Caller",
                "group": "general"
            },
            "cb": {
                "name": "Callback property",
                "group": "general"
            },
            "cid": {
                "name": "Data Provider (User) IDs",
                "group": "general"
            },
            "ciic": {
                "name": "Integration Code / User ID",
                "group": "general"
            },
            "coppa": {
                "name": "COPPA Request",
                "group": "general"
            },
            "cts": {
                "name": "Return Traits & Segments in Response",
                "group": "general"
            },
            "dpid": {
                "name": "Data Provider ID",
                "group": "general"
            },
            "dpuuid": {
                "name": "Data Provider User ID",
                "group": "general"
            },
            "dst": {
                "name": "Return URL Destination in Response",
                "group": "general"
            },
            "dst_filter": {
                "name": "Adobe Analytics Integration",
                "group": "general"
            },
            "jsonv": {
                "name": "JSON Response Version",
                "group": "general"
            },
            "mid": {
                "name": "Experience Cloud ID",
                "group": "general"
            },
            "nsid": {
                "name": "Name Space ID",
                "group": "general"
            },
            "ptfm": {
                "name": "Platform",
                "group": "general"
            },
            "rs": {
                "name": "Legacy Adobe Analytics Integration",
                "group": "general"
            },
            "rtbd": {
                "name": "Return Method",
                "group": "general"
            },
            "sid": {
                "name": "Score ID",
                "group": "general"
            },
            "tdpid": {
                "name": "Trait Source",
                "group": "general"
            },
            "tdpiic": {
                "name": "Trait Source (Integration Code)",
                "group": "general"
            },
            "uuid": {
                "name": "Unique User ID",
                "group": "general"
            },
        };
    }

    /**
     * Parse a given URL into human-readable output
     *
     * @param {string}  rawUrl      A URL to check against
     * @param {string}  postData    POST data, if applicable
     *
     * @return {{provider: {name: string, key: string, type: string}, data: Array}}
     */
    parseUrl(rawUrl, postData = "")
    {
        let url = new URL(rawUrl),
            data = [],
            params = new URLSearchParams(url.search);

        // Force Adobe's path into query strings
        if(url.pathname.indexOf("/ibs:") === 0) {
            url.pathname.replace("/ibs:", "").split("&").forEach(param => {
                let pair = param.split("=");
                params.append(pair[0], pair[1]);
            });
        }
        for(let param of params)
        {
            let key = param[0],
                value = param[1],
                result = this.handleQueryParam(key, value);
            if(typeof result === "object") {
                data.push(result);
            }
        }

        let customData = this.handleCustom(url, params);
        /* istanbul ignore else */
        if(typeof customData === "object" && customData !== null)
        {
            data = data.concat(customData);
        }

        return {
            "provider": {
                "name":    this.name,
                "key":     this.key,
                "type":    this.type,
                "columns": this.columnMapping,
                "groups":  this.groups
            },
            "data": data
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^c_(.+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": name,
                "value": value,
                "group": "custom"
            };
        } else if(/^p_(.+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": name,
                "value": value,
                "group": "private"
            };
        } else if(/^d_(.+)$/i.test(name) && this.keys[RegExp.$1]) {
            result = {
                "key":   name,
                "field": this.keys[RegExp.$1].name,
                "value": value,
                "group": this.keys[RegExp.$1].group
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            accountID = url.hostname.replace(/^(dpm)?\.demdex.net/i, ""),
            requestType = url.pathname.match(/^\/([^?/#:]+)/);
        results.push({
            "key":   "omnibug_account",
            "value": accountID,
            "hidden": true
        });

        if(requestType[1] === "ibs") {
            requestType = "ID Sync";
        } else if(requestType[1] === "event") {
            requestType = "Event";
        } else {
            requestType = requestType[1];
        }
        results.push({
            "key":   "omnibug_requestType",
            "value": requestType,
            "hidden": true
        });
        return results;
    }
}

/**
 * Adobe Dynamic Tag Manager (DTM)
 * https://dtm.adobe.com/
 *
 * @class
 * @extends BaseProvider
 */
class AdobeDynamicTagManagerProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBEDTM";
        this._pattern    = /\/satelliteLib-[^.]+\.js/;
        this._name       = "Adobe Dynamic Tag Manager";
        this._type       = "tagmanager";
        this._keywords   = ["dtm", "activate", "activation", "tms"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "environment",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matches =  url.pathname.match(/\/satelliteLib-[^.-]+(-staging)?\.js/),
            env = (matches && matches[1]) ? matches[1].replace("-", "") : "production",
            results = [];
        results.push({
            "key":   "environment",
            "field": "DTM Environment",
            "value": env,
            "group": "general"
        });
        results.push({
            "key": "_requestType",
            "value": "Library Load",
            "hidden": true,
        });
        return results;
    }
}

/**
 * Adobe Experience ID Service
 * http://www.adobe.com/data-analytics-cloud/audience-manager.html
 *
 * @class
 * @extends BaseProvider
 */
class AdobeExperienceIDProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBEEXPERIENCEID";
        this._pattern    = /\/id\?(?=.*d_visid_ver=)(?=.*(d_orgid|mcorgid)=)/;
        this._name       = "Adobe Experience Cloud ID";
        this._type       = "visitorid";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "requestType": "omnibug_requestType",
            "account": "omnibug_account"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "d_orgid": {
                "name": "Adobe Organization ID",
                "group": "general"
            },
            "d_rtbd": {
                "name": "Return Method",
                "group": "general"
            },
            "d_cb": {
                "name": "Callback property",
                "group": "general"
            },
            "mcorgid": {
                "name": "Adobe Organization ID",
                "group": "general"
            },
            "d_visid_ver": {
                "name": "Experience Cloud ID Version",
                "group": "general"
            },
            "d_cid_ic": {
                "name": "Integration Code / User ID",
                "group": "general"
            },
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            accountID = "";
        if(params.get("d_orgid")) {
            accountID = params.get("d_orgid");
        } else if(params.get("mcorgid")) {
            accountID = params.get("mcorgid");
        }
        results.push({
            "key":   "omnibug_account",
            "value": accountID,
            "hidden": true
        });
        return results;
    }
}
/**
 * Adobe Heartbeat
 * https://marketing.adobe.com/resources/help/en_US/sc/appmeasurement/hbvideo/
 *
 * @class
 * @extends BaseProvider
 */
class AdobeHeartbeatProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBEHEARTBEAT";
        this._pattern    = /\.hb\.omtrdc\.net\/|\/api\/v1\/sessions/;
        this._name       = "Adobe Heartbeat";
        this._type       = "analytics";
        this._keywords   = ["video"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "omnibug_account",
            "requestType":  "omnibug_requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "customMetadata",
                "name": "Custom Meta Data"
            },
            {
                "key": "analytics",
                "name": "Analytics"
            },
            {
                "key": "visitorID",
                "name": "Visitor ID"
            },
            {
                "key": "media",
                "name": "Media Content"
            },
            {
                "key": "ads",
                "name": "Media Ads"
            },
            {
                "key": "player",
                "name": "Player"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "s:asset:video_id": {
                "name": "Content ID",
                "group": "general"
            },
            "l:asset:length": {
                "name": "Video Length",
                "group": "general"
            },
            "s:stream:type": {
                "name": "Content Type",
                "group": "general"
            },
            "s:event:sid": {
                "name": "Video Session ID",
                "group": "general"
            },
            "s:sp:player_name": {
                "name": "Content Player Name",
                "group": "general"
            },
            "s:sp:channel": {
                "name": "Content Channel",
                "group": "general"
            },
            "s:asset:name": {
                "name": "Video Name",
                "group": "general"
            },
            "s:sp:sdk": {
                "name": "SDK Version",
                "group": "general"
            },
            "s:sp:hb_version": {
                "name": "VHL Version",
                "group": "general"
            },
            "s:meta:a.media.show": {
                "name": "Show",
                "group": "general"
            },
            "s:meta:a.media.format": {
                "name": "Stream Format",
                "group": "general"
            },
            "s:meta:a.media.season": {
                "name": "Season",
                "group": "general"
            },
            "s:meta:a.media.episode": {
                "name": "Episode",
                "group": "general"
            },
            "s:meta:a.media.asset": {
                "name": "Asset ID",
                "group": "general"
            },
            "s:meta:a.media.genre": {
                "name": "Genre",
                "group": "general"
            },
            "s:meta:a.media.airDate": {
                "name": "First Air Date",
                "group": "general"
            },
            "s:meta:a.media.digitalDate": {
                "name": "First Digital Date",
                "group": "general"
            },
            "s:meta:a.media.rating": {
                "name": "Content Rating",
                "group": "general"
            },
            "s:meta:a.media.originator": {
                "name": "Originator",
                "group": "general"
            },
            "s:meta:a.media.network": {
                "name": "Network",
                "group": "general"
            },
            "s:meta:a.media.type": {
                "name": "Show Type",
                "group": "general"
            },
            "s:meta:a.media.pass.mvpd": {
                "name": "MVPD",
                "group": "general"
            },
            "s:meta:a.media.pass.auth": {
                "name": "Authorized",
                "group": "general"
            },
            "s:meta:a.media.dayPart": {
                "name": "Day Part",
                "group": "general"
            },
            "s:meta:a.media.feed": {
                "name": "Video Feed Type",
                "group": "general"
            },
            "s:meta:a.media.adload": {
                "name": "Ad Load Type",
                "group": "general"
            },
            "s:event:type": {
                "name": "Event Type",
                "group": "general"
            },
            "params.analytics.trackingServer": {
                "name": "Tracking Server",
                "group": "analytics"
            },
            "params.analytics.reportSuite": {
                "name": "Report Suite",
                "group": "analytics"
            },
            "params.analytics.enableSSL": {
                "name": "Enable SSL",
                "group": "analytics"
            },
            "params.analytics.visitorId": {
                "name": "Analytics Visitor ID",
                "group": "visitorID"
            },
            "params.visitor.marketingCloudOrgId": {
                "name": "Experience Cloud Org ID",
                "group": "visitorID"
            },
            "params.visitor.marketingCloudUserId": {
                "name": "Experience Cloud User ID",
                "group": "visitorID"
            },
            "params.visitor.aamLocationHint": {
                "name": "Adobe Audience Manager Edge Data",
                "group": "visitorID"
            },
            "params.appInstallationId": {
                "name": "App/Device ID",
                "group": "visitorID"
            },
            "params.analytics.optOutServerSideForwarding	": {
                "name": "Analytics Server-Side Opt Out",
                "group": "visitorID"
            },
            "params.analytics.optOutShare	": {
                "name": "Analytics Federated Opt Out",
                "group": "visitorID"
            },
            "params.media.state.name": {
                "name": "Media State",
                "group": "media"
            },
            "params.media.id": {
                "name": "Content ID",
                "group": "media"
            },
            "params.media.name": {
                "name": "Content Name",
                "group": "media"
            },
            "params.media.length": {
                "name": "Content Length",
                "group": "media"
            },
            "params.media.contentType": {
                "name": "Content Format",
                "group": "media"
            },
            "params.media.streamType": {
                "name": "Stream Type",
                "group": "media"
            },
            "params.media.playerName": {
                "name": "Player Name",
                "group": "player"
            },
            "params.media.channel": {
                "name": "Content Channel",
                "group": "media"
            },
            "params.media.resume": {
                "name": "Session Resume",
                "group": "media"
            },
            "params.media.sdkVersion": {
                "name": "SDK Name",
                "group": "general"
            },
            "params.media.libraryVersion": {
                "name": "SDK Version",
                "group": "general"
            },
            "params.media.show": {
                "name": "Show / Series Name",
                "group": "media"
            },
            "params.media.season": {
                "name": "Season Number",
                "group": "media"
            },
            "params.media.episode": {
                "name": "Episode Number",
                "group": "media"
            },
            "params.media.assetId": {
                "name": "Asset ID",
                "group": "media"
            },
            "params.media.genre": {
                "name": "Genre",
                "group": "media"
            },
            "params.media.firstAirDate": {
                "name": "First Air Date",
                "group": "media"
            },
            "params.media.firstDigitalDate": {
                "name": "First Digital Date",
                "group": "media"
            },
            "params.media.rating": {
                "name": "Rating",
                "group": "media"
            },
            "params.media.originator": {
                "name": "Originator",
                "group": "media"
            },
            "params.media.network": {
                "name": "Network",
                "group": "media"
            },
            "params.media.showType": {
                "name": "Content Type",
                "group": "media"
            },
            "params.media.adLoad": {
                "name": "Ad Type",
                "group": "ads"
            },
            "params.media.pass.mvpd": {
                "name": "MVPD",
                "group": "media"
            },
            "params.media.pass.auth": {
                "name": "Adobe Auth",
                "group": "media"
            },
            "params.media.dayPart": {
                "name": "Timeparting",
                "group": "media"
            },
            "params.media.feed": {
                "name": "Feed Type",
                "group": "media"
            },
            "params.media.ad.podFriendlyName": {
                "name": "Ad Break Name",
                "group": "ads"
            },
            "params.media.ad.podIndex": {
                "name": "Ad Break Index",
                "group": "ads"
            },
            "params.media.ad.podSecond": {
                "name": "Ad Break Start Time",
                "group": "ads"
            },
            "params.media.ad.podPosition": {
                "name": "Ad Break Position",
                "group": "ads"
            },
            "params.media.ad.name": {
                "name": "Ad Name",
                "group": "ads"
            },
            "params.media.ad.id": {
                "name": "Ad ID",
                "group": "ads"
            },
            "params.media.ad.length": {
                "name": "Ad Length",
                "group": "ads"
            },
            "params.media.ad.playerName": {
                "name": "Ad Player Name",
                "group": "ads"
            },
            "params.media.ad.advertiser": {
                "name": "Advertiser",
                "group": "ads"
            },
            "params.media.ad.campaignId": {
                "name": "Ad Campaign ID",
                "group": "ads"
            },
            "params.media.ad.creativeId": {
                "name": "Ad Creative ID",
                "group": "ads"
            },
            "params.media.ad.siteId": {
                "name": "Ad Site ID",
                "group": "ads"
            },
            "params.media.ad.creativeURL": {
                "name": "Ad Creative URL",
                "group": "ads"
            },
            "params.media.ad.placementId": {
                "name": "Ad Placement ID",
                "group": "ads"
            },
            "params.media.chapter.index": {
                "name": "Chapter Index",
                "group": "media"
            },
            "params.media.chapter.offset": {
                "name": "Chapter Time Start",
                "group": "media"
            },
            "params.media.chapter.length": {
                "name": "Chapter Length",
                "group": "media"
            },
            "params.media.chapter.friendlyName": {
                "name": "Chapter Name",
                "group": "media"
            },
            "qoeData.media.qoe.bitrate": {
                "name": "Player Bitrate",
                "group": "player"
            },
            "qoeData.media.qoe.droppedFrames": {
                "name": "Dropped Frames",
                "group": "player"
            },
            "qoeData.media.qoe.framesPerSecond": {
                "name": "Frames Per Second",
                "group": "player"
            },
            "qoeData.media.qoe.timeToStart": {
                "name": "Time to Start",
                "group": "player"
            },
            "eventType": {
                "name": "Event Type",
                "group": "general"
            },
        };
    }


    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^customMetadata\./i.test(name)) {
            result = {
                "key":   name,
                "field": name.replace(/^customMetadata\./i, ""),
                "value": value,
                "group": "customMetadata"
            };
        } else if(/^params\.analytics\./i.test(name) && !(name in this.keys)) {
            result = {
                "key":   name,
                "field": name.replace(/^params\.analytics\./i, ""),
                "value": value,
                "group": "analytics"
            };
        } else if(/^params\.visitor\./i.test(name) && !(name in this.keys)) {
            result = {
                "key":   name,
                "field": name.replace(/^params\.visitor\./i, ""),
                "value": value,
                "group": "visitorID"
            };
        } else if(/^params\.media\.ad\./i.test(name) && !(name in this.keys)) {
            result = {
                "key":   name,
                "field": name.replace(/^params\.media\.ad\./i, ""),
                "value": value,
                "group": "ads"
            };
        } else if(/^params\.media\./i.test(name) && !(name in this.keys)) {
            result = {
                "key":   name,
                "field": name.replace(/^params\.media\./i, ""),
                "value": value,
                "group": "media"
            };
        } else if(/^(playerTime|media\.player)?\./i.test(name) && !(name in this.keys)) {
            result = {
                "key":   name,
                "field": name.replace(/^(playerTime|media\.player)\./i, ""),
                "value": value,
                "group": "player"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [], event = "", account = "";

        if(/\/api\/v1\/sessions\/?(([^/?#]+))?/.test(url)) {
            // Media SDK v3
            event = params.get("eventType") || "";
            account = params.get("params.analytics.reportSuite");
            if(RegExp.$1) {
                results.push({
                    "key":   "omnibug_sessionID",
                    "field": "Media Session ID",
                    "value": RegExp.$1,
                    "group": "general"
                });
            }
        } else {
            // Media SDK v1/v2
            event = params.get("s:event:type");
            account = params.get("s:sc:rsid");
        }

        results.push({
            "key":   "omnibug_account",
            "value": account,
            "hidden": true
        });
        results.push({
            "key":   "omnibug_requestType",
            "value": event.charAt(0).toUpperCase() + event.slice(1),
            "hidden": true
        });
        return results;
    }
}

/**
 * Adobe Launch
 * https://launch.adobe.com/
 *
 * @class
 * @extends BaseProvider
 */
class AdobeLaunchProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBELAUNCH";
        this._pattern    = /assets\.adobedtm\.com(?:\/[^?#;]+)?\/launch-[^?#]+.js/;
        this._name       = "Adobe Launch";
        this._type       = "tagmanager";
        this._keywords   = ["activate", "activation", "tms"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "environment",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matches =  url.pathname.match(/\/launch-[^.-]+(-[^.]+)(?:\.min)?\.js/),
            env = (matches && matches[1]) ? matches[1].replace("-", "") : "production",
            results = [];
        results.push({
            "key":   "environment",
            "field": "Launch Environment",
            "value": env,
            "group": "general"
        });
        results.push({
            "key": "_requestType",
            "value": "Library Load",
            "hidden": true,
        });

        return results;
    }
}

/**
 * Adobe Launch CN
 * https://launch.adobe.com/
 *
 * @class
 * @extends BaseProvider
 */
class AdobeLaunchCNProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBELAUNCH_CN";
        this._pattern    = /assets\.adoberesources\.cn(?:\/[^?#;]+)?\/launch-[^?#]+.js/;
        this._name       = "Adobe Launch China Node";
        this._type       = "tagmanager";
        this._keywords   = ["activate", "activation", "tms"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "environment",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matches =  url.pathname.match(/\/launch-[^.-]+(-[^.]+)(?:\.min)?\.js/),
            env = (matches && matches[1]) ? matches[1].replace("-", "") : "production",
            results = [];
        results.push({
            "key":   "environment",
            "field": "Launch Environment",
            "value": env,
            "group": "general"
        });
        results.push({
            "key": "_requestType",
            "value": "Library Load",
            "hidden": true,
        });

        return results;
    }
}

/**
 * Adobe Target
 * http://www.adobe.com/marketing-cloud/target.html
 *
 * @class
 * @extends BaseProvider
 */
class AdobeTargetProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBETARGET";
        this._pattern    = /\.tt\.omtrdc\.net\/(?!cdn\/)/;
        this._name       = "Adobe Target";
        this._type       = "testing";
        this._keywords   = ["test target", "test & target", "at", "tnt", "t&t", "omniture"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "mbox",
            "requestType":  "mboxType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "profile",
                "name": "Profile Attributes"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "mbox": {
                "name": "Mbox Name",
                "group": "general"
            },
            "mboxType": {
                "name": "Mbox Type",
                "group": "general"
            },
            "mboxCount": {
                "name": "Mbox Count",
                "group": "general"
            },
            "mboxId": {
                "name": "Mbox ID",
                "group": "general"
            },
            "mboxSession": {
                "name": "Mbox Session",
                "group": "general"
            },
            "mboxPC": {
                "name": "Mbox PC ID",
                "group": "general"
            },
            "mboxPage": {
                "name": "Mbox Page ID",
                "group": "general"
            },
            "clientCode": {
                "name": "Client Code",
                "group": "general"
            },
            "mboxHost": {
                "name": "Page Host",
                "group": "general"
            },
            "mboxURL": {
                "name": "Page URL",
                "group": "general"
            },
            "mboxReferrer": {
                "name": "Page Referrer",
                "group": "general"
            },
            "screenHeight": {
                "name": "Screen Height",
                "group": "general"
            },
            "screenWidth": {
                "name": "Screen Width",
                "group": "general"
            },
            "browserWidth": {
                "name": "Browser Width",
                "group": "general"
            },
            "browserHeight": {
                "name": "Browser Height",
                "group": "general"
            },
            "browserTimeOffset": {
                "name": "Browser Timezone Offset",
                "group": "general"
            },
            "colorDepth": {
                "name": "Browser Color Depth",
                "group": "general"
            },
            "mboxXDomain": {
                "name": "CrossDomain Enabled",
                "group": "general"
            },
            "mboxTime": {
                "name": "Timestamp",
                "group": "general"
            },
            "mboxVersion": {
                "name": "Library Version",
                "group": "general"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(name.indexOf("profile.") === 0) {
            result = {
                "key":   name,
                "field": name.slice(8),
                "value": value,
                "group": "profile"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matches =  url.pathname.match( /\/([^/]+)\/mbox\/([^/?]+)/ ),
            results = [];
        if(matches !== null && matches.length === 3) {
            results.push({
                "key":   "clientCode",
                "field": "Client Code",
                "value": matches[1],
                "group": "general"
            });
            results.push({
                "key":   "mboxType",
                "field": "Mbox Type",
                "value": matches[2],
                "group": "general"
            });
        }

        return results;
    }
}
/**
 * Adobe Analytics
 * http://www.adobe.com/data-analytics-cloud/analytics.html
 *
 * @class
 * @extends BaseProvider
 */
class AdobeWebSdkProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ADOBEWEBSDK";
        this._pattern    = /\/ee\/.+[&?]configId=[0-9a-f]{8}\b-[0-9a-f]{4}\b-[0-9a-f]{4}\b-[0-9a-f]{4}\b-[0-9a-f]{12}/i;
        this._name       = "Adobe Experience Platform Web SDK";
        this._type       = "analytics";
        this._keywords   = ["alloy", "aep", "edge"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "configId",
            "requestType":  "eventName"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general", 
                "name": "General"
            },
            {
                "key": "events",
                "name": "Events"
            },
            {
                "key": "query",
                "name": "Query"
            },
            {
                "key": "meta",
                "name": "Metadata"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "configId": {
                "name": "Datastream ID (Config ID)",
                "group": "general"
            },
            "requestId": {
                "name": "Request ID",
                "group": "general"
            },

        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        if(/^meta\./.test(name)) {
            return {
                "key":   name,
                "field": name.replace(/^meta\./g, ""),
                "value": value,
                "group": "meta"
            };
        }
        if(/^query\./.test(name)) {
            return {
                "key":   name,
                "field": name.replace(/^query\./g, ""),
                "value": value,
                "group": "query"
            };
        }
        let eventMatch = name.match(/^events\[(\d+)]\./);
        if(eventMatch && eventMatch.length === 2) {
            return {
                "key":   name,
                "field": name,
                "value": value,
                "group": "events"
            };
        }
        return super.handleQueryParam(name, value);
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [];

        params = Array.from(params);

        let requestType = (new URL(url)).pathname.split("/").pop();

        let eventNames = params
            .filter(([key, value]) => /\.eventType$/.test(key))
            .map(([key, value]) => value)
            .join(", ");
        if(!eventNames) {
            eventNames = requestType;
        }

        results.push({
            "key":   "omnibug_requestType",
            "field":   "Request Type",
            "value": requestType,
            "group": "general"
        });
        results.push({
            "key":   "eventName",
            "value": eventNames,
            "hidden": true
        });
        return results;
    }
}

/**
 * Amazon Ad Tag
 * (No real dev docs)
 * 
 * @class
 * @extends BaseProvider
 */
class AmazonAdTagProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "AMAZONADTAG";
        this._pattern = /amazon-adsystem\.com\/iu3/;
        this._name = "Amazon Ad Tag";
        this._type = "marketing";
        this._keywords = ["AAT"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     * The account is unique to each TikTok pixel event, meaning multiple events firing from the same pixel SDK will have discreet identifiers
     * 
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "pid",
            "requestType": "event",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "event": {
                "name": "Event Name",
                "group": "general"
            },
            "pid": {
                "name": "Pixel ID",
                "group": "general"
            },
            "ts": {
                "name": "Timestamp",
                "group": "general"
            },
        };
    }
}

/**
 * Amplitude
 * https://www.amplitude.com/
 * https://www.docs.developers.amplitude.com/data/sdks/browser-2/
 *
 * @class
 * @extends BaseProvider
 */
class AmplitudeProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "AMPLITUDE";
        this._pattern = /amplitude\.com\/2\/httpapi/;
        this._name = "Amplitude";
        this._type = "analytics";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "api_key",
            "requestType": "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "events",
                "name": "Events"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "api_key": {
                "name": "API Key",
                "group": "general"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        if(/^events\[/i.test(name)) {
            return {
                "key":   name,
                "field": name,
                "value": value,
                "group": "events"
            };
        }
        return super.handleQueryParam(name, value);
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            requestType = [];

        params.forEach((value, key) => {
            if(/\.event_type$/.test(key)) {
                requestType.push(value);
            }
        });

        if(requestType.length) {
            requestType = `(${requestType.length}) ${requestType.join(", ")}`;
        } else {
            requestType = "Other";
        }

        results.push({
            "key": "requestTypeParsed",
            "value": requestType,
            "hidden": true
        });

        return results;
    }
}

/**
 * AT Internet
 * https://www.atinternet.com/
 *
 * @class
 * @extends BaseProvider
 */
class ATInternetProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ATINTERNET";
        this._pattern    = /^([^#?]+)(\/hit\.xiti)/;
        this._name       = "AT Internet";
        this._type       = "analytics";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "s",
            "requestType":  "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "content",
                "name": "Content Variables"
            },
            {
                "key": "custom",
                "name": "Custom Variables"
            },
            {
                "key": "media",
                "name": "Media Variables"
            },
            {
                "key": "click",
                "name": "Click Variables"
            }
        ];
    }


    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "col": {
                "name": "Protocol Version",
                "group": "general"
            },
            "vtag": {
                "name": "Library Version",
                "group": "general"
            },
            "ptag": {
                "name": "Tag Type",
                "group": "general"
            },
            "r": {
                "name": "Screen Info",
                "group": "general"
            },
            "re": {
                "name": "Window Resolution",
                "group": "general"
            },
            "ref": {
                "name": "Referrer",
                "group": "general"
            },
            "lng": {
                "name": "Language",
                "group": "general"
            },
            "ts": {
                "name": "Timestamp",
                "group": "general"
            },
            "from": {
                "name": "Method of Hit Generation",
                "group": "general"
            },
            "s": {
                "name": "Site Number",
                "group": "general"
            },
            "idclient": {
                "name": "Unique Visitor ID",
                "group": "general"
            },
            "an": {
                "name": "Visitor Numerical ID",
                "group": "general"
            },
            "at": {
                "name": "Visitor Textual ID",
                "group": "general"
            },
            "ac": {
                "name": "Visitor Category ID",
                "group": "general"
            },
            "dg": {
                "name": "Display Size Type",
                "group": "general"
            },
            "p": {
                "name": "Content",
                "group": "content"
            },
            "s2": {
                "name": "Level 2",
                "group": "content"
            },
            "click": {
                "name": "Click Type",
                "group": "click"
            },
            "pclick": {
                "name": "Clicked Page Name",
                "group": "click"
            },
            "s2click": {
                "name": "Clicked Level 2",
                "group": "click"
            },
            "mc": {
                "name": "Search Keyword",
                "group": "content"
            },
            "np": {
                "name": "Search Results Count",
                "group": "content"
            },
            "mcrg": {
                "name": "Search Results Position Clicked",
                "group": "click"
            },
            "ptype": {
                "name": "Custom Tree",
                "group": "general"
            },
            "aisl": {
                "name": "Aisles",
                "group": "general"
            },
            "action": {
                "name": "Action",
                "group": "media"
            },
            "type": {
                "name": "Media Type",
                "group": "media"
            },
            "m6": {
                "name": "Broadcast Type",
                "group": "media"
            },
            "m1": {
                "name": "Content Duration",
                "group": "media"
            },
            "m5": {
                "name": "Broadcast Location",
                "group": "media"
            },
            "buf": {
                "name": "Buffering",
                "group": "media"
            },
            "prich": {
                "name": "Page",
                "group": "media"
            },
            "s2rich": {
                "name": "Page Level 2",
                "group": "media"
            },
            "plyr": {
                "name": "Player ID",
                "group": "media"
            },
            "clnk": {
                "name": "Linked Content",
                "group": "media"
            },
            "m9": {
                "name": "Broadcast Domain",
                "group": "media"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^x(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": "Custom Site " + RegExp.$1,
                "value": value,
                "group": "custom"
            };
        } else if(/^f(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": "Custom Page " + RegExp.$1,
                "value": value,
                "group": "custom"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            type = params.get("type"),
            requestType = type || "Page View";

        results.push({
            "key":   "trackingServer",
            "field": "Tracking Server",
            "value": url.hostname,
            "group": "general",
        });
        results.push({
            "key":   "requestType",
            "value": requestType,
            "hidden": true
        });
        return results;
    }
}
/**
 * Bing Ads UET
 * https://about.ads.microsoft.com/en-us/solutions/audience-targeting/universal-event-tracking
 *
 * @class
 * @extends BaseProvider
 */
class BingAdsProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "BINGUET";
        this._pattern = /bat\.bing\.com\/action/;
        this._name = "Bing Ads";
        this._type = "marketing";
        this._keywords = ["UET", "uetq", "Microsoft", "MSN", "atdmt", "bat.js"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "ti",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "events",
                "name": "Events"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "ti": {
                "name": "Tag ID",
                "group": "general"
            },
            "ec": {
                "name": "Event Category",
                "group": "events"
            },
            "ea": {
                "name": "Event Action",
                "group": "events"
            },
            "el": {
                "name": "Event Label",
                "group": "events"
            },
            "ev": {
                "name": "Event Value",
                "group": "events"
            },
            "gv": {
                "name": "Goal Revenue",
                "group": "events"
            },
            "prodid": {
                "name": "Product ID",
                "group": "events"
            },
            "pagetype": {
                "name": "Page Type",
                "group": "general"
            },
            "evt": {
                "name": "Event Type",
                "group": "general"
            },
            "spa": {
                "name": "Single Page App",
                "group": "general"
            },
            "page_path": {
                "name": "Page Path",
                "group": "general"
            },
            "p": {
                "name": "Page URL",
                "group": "general"
            },
            "tl": {
                "name": "Page Title",
                "group": "other"
            },
            "kw": {
                "name": "Keywords Meta Tag",
                "group": "other"
            },
            "r": {
                "name": "Page Referrer",
                "group": "other"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            event = params.get("evt"),
            requestType = "other";

        if (event === "pageLoad") {
            requestType = "Page View";
        } else {
            requestType = event.charAt(0).toUpperCase() + event.slice(1);
        }

        results.push({
            "key": "requestType",
            "value": requestType,
            "hidden": true
        });

        return results;
    }
}
/**
 * Braze
 * https://www.braze.com/
 * https://www.braze.com/docs/developer_guide/home

 *
 * @class
 * @extends BaseProvider
 */

class BrazeProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "BRAZE";
        this._pattern   = /\.braze\.com\/api\/v3\/data/;
        this._name      = "Braze";
        this._type      = "customer";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "api_key",
            "requestType":  "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                key: "general",
                name: "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    /*
    handleCustom(url, params)
    {
        let results = [];

        // Account info
        const accountInfo =  url.pathname.match(/\/scripts\/(\d+\/\d+)\.js/);
        if(accountInfo !== null) {
            results.push({
                "key":   "_accountID",
                "field": "Account ID",
                "value": `${accountInfo[1].replace("/", "")}`,
                "group": "general"
            });
        }

        results.push({
            "key":   "requestTypeParsed",
            "field": "Request Type",
            "value": "Library Load",
            "group": "general"
        });


        return results;
    } // handle custom
    */
} // class

/**
 * Brevo (f/k/a Sendinblue)
 * https://developers.brevo.com/docs/gettings-started-with-sendinblue-tracker
 *
 * @class
 * @extends BaseProvider
 */
class BrevoProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "BREVO";
        this._pattern = /in-automate\.brevo\.com\/p/;
        this._name = "Brevo";
        this._type = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "key",
            "requestType": "sib_type"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "key": {
                "name": "Tracking ID",
                "group": "general"
            },
            "sib_type": {
                "name": "Request Type",
                "group": "general"
            }
        };
    }
}

/**
 * Comscore
 * https://direct.comscore.com/clients/help/FAQ.aspx#faqTagging
 *
 * @class
 * @extends BaseProvider
 */

class ComscoreProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "COMSCORE";
        this._pattern = /sb\.scorecardresearch\.com(?!.*\.js($|[?#]))/;
        this._name = "Comscore";
        this._type = "marketing";
    }

    /**
   * Retrieve the column mappings for default columns (account, event type)
   *
   * @return {{}}
   */
    get columnMapping() {
        return {
            account: "c2",
            requestType: "c1"
        };
    }

    /**
   * Retrieve the group names & order
   *
   * @returns {*[]}
   */
    get groups() {
        return [
            {
                key: "custom",
                name: "Custom"
            }
        ];
    }

    /**
   * Parse a given URL parameter into human-readable form
   *
   * @param {string}  name
   * @param {string}  value
   *
   * @returns {void|{}}
   */
    handleQueryParam(name, value) {
        let result = {};
        const customRegex = /^c\S+$/;
        if (name.match(customRegex)) {
            result = {
                key: name,
                field: name,
                value: value,
                group: "custom"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }
}

/**
 * Crazy Egg
 * https://www.crazyegg.com/
 * https://developer.medallia.com/medallia-dxa/docs/introduction

 *
 * @class
 * @extends BaseProvider
 */

class CrazyEggProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "CRAZYEGG";
        this._pattern   = /script\.crazyegg\.com\/pages\/scripts\//;
        this._name      = "Crazy Egg";
        this._type      = "replay";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "_accountID",
            "requestType":  "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                key: "general",
                name: "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let results = [];

        // Account info
        const accountInfo =  url.pathname.match(/\/scripts\/(\d+\/\d+)\.js/);
        if(accountInfo !== null) {
            results.push({
                "key":   "_accountID",
                "field": "Account ID",
                "value": `${accountInfo[1].replace("/", "")}`,
                "group": "general"
            });
        }

        results.push({
            "key":   "requestTypeParsed",
            "field": "Request Type",
            "value": "Library Load",
            "group": "general"
        });


        return results;
    } // handle custom
} // class

/**
 * Criteo OneTag
 * https://www.criteo.com/
 *
 * @class
 * @extends BaseProvider
 */

class CriteoOneTagProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "CRITEOONETAG";
        this._pattern = /sslwidget\.criteo\.com\/event/;
        this._name = "Criteo OneTag";
        this._type = "marketing";
    }

    /**
   * Retrieve the column mappings for default columns (account, event type)
   *
   * @return {{}}
   */
    get columnMapping() {
        return {
            account: "a",
            requestType: "requestType"
        };
    }

    /**
   * Retrieve the group names & order
   *
   * @returns {*[]}
   */
    get groups() {
        return [
            {
                key: "general",
                name: "General"
            },
            {
                key: "events",
                name: "Events"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "a": {
                "name": "Account ID",
                "group": "general"
            },
            "v": {
                "name": "Tag Version",
                "group": "other"
            },
            "tld": {
                "name": "Top-Level Domain",
                "group": "other"
            }
        };
    }

    /**
   * Parse a given URL parameter into human-readable form
   *
   * @param {string}  name
   * @param {string}  value
   *
   * @returns {void|{}}
   */
    handleQueryParam(name, value) {
        let result = {}, x = false;
        if (x) {
            // do nothing
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            requestType = [];

        // Grab the request type - in the future we'll attempt to better parse the actual results
        params.forEach((value, key) => {
            if (/^p\d+$/.test(key)) {
                let values = value.split("&");
                if (/^e=/.test(values[0])) {
                    let type = this._handleEventName(values[0].split("=")[1]);
                    if (type) {
                        requestType.push(type);
                    }
                }
            }
        });

        results.push({
            "key": "requestType",
            "value": requestType.length ? requestType.join(" | ") : "other",
            "hidden": true
        });

        return results;
    }

    _handleEventName(name) {
        let lookupTable = {
            "vh": "Homepage",
            "vl": "Search Listing View",
            "vp": "Product View",
            "vb": "Cart View",
            "vc": "Purchase"
        };
        return lookupTable[name] ? lookupTable[name] : false;
    }
}

/**
 * Demandbase Engagement
 * https://www.demandbase.com/solutions/engagement/
 *
 * @class
 * @extends BaseProvider
 */
class DemandbaseEngagementProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "DEMANDBASEENGAGEMENT";
        this._pattern    = /api\.company-target\.com\/api\/v2\/ip\.json/;
        this._name       = "Demandbase Engagement";
        this._type       = "visitorid";
        this._keywords   = ["ip lookup"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "key"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "page": {
                "name": "Page URL",
                "group": "general"
            },
            "page_title": {
                "name": "Page Title",
                "group": "general"
            },
            "key": {
                "name": "Account ID",
                "group": "general"
            },
            "referrer": {
                "name": "Page Referrer",
                "group": "general"
            },
            "src": {
                "name": "Called From",
                "group": "other"
            },
        };
    }
}

/**
 * Dynamic Yield
 * https://dy.dev/docs/implement-script
 *
 * @class
 * @extends BaseProvider
 */
class DynamicYieldProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "DYNAMICYIELD";
        this._pattern = /async-px\.dynamicyield\.com\/(?:uia|imp|var|ac|id)/;
        this._name = "Dynamic Yield";
        this._type = "testing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "_omnibugAccount",
            "requestType": "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "se": {
                "name": "Section ID",
                "group": "general"
            },
            "sec": {
                "name": "Section ID",
                "group": "general"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        const results = [];
        const accountId = params.get("sec") || params.get("se") || "";
        results.push({
            "key":   "_omnibugAccount",
            "value": accountId,
            "hidden": true,
        });

        const requestTypeMatch = url.pathname.replace(/\//g, "");
        let requestType = {
            "uia": "Page Info",
            "imp": "Monitor Units",
            "var": "Variation Impression",
            "ac": "Variation Click",
            "id": "User ID"
        }[requestTypeMatch] || "Other";

        results.push({
            "key": "_requestType",
            "value": requestType,
            "hidden": true,
        });

        return results;
    }
}

/**
 * Ensighten Manage
 * https://cheq.ai/ensighten/enterprise-tag-management/
 *
 * @class
 * @extends BaseProvider
 */
class EnsightenManageProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ENSIGHTENMANAGE";
        this._pattern    = /nexus(?:-test)?\.ensighten\.com\/(?=.*Bootstrap\.js)/;
        this._name       = "Ensighten Manage";
        this._type       = "tagmanager";
        this._keywords   = ["tms", "cheq"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "omnibug_account",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matches =  url.pathname.match(/^\/([^/]+)\/(?:([^/]+)\/)?Bootstrap\.js/),
            results = [];
        /* istanbul ignore else */
        if(matches !== null) {
            matches[2] = matches[2] || "prod";
            results.push({
                "key":   "omnibug_account",
                "value": `${matches[1]} / ${matches[2]}`,
                "hidden": true
            });
            results.push({
                "key":   "client",
                "field": "Client",
                "value": matches[1],
                "group": "general"
            });
            results.push({
                "key":   "profile",
                "field": "Profile",
                "value": matches[2],
                "group": "general"
            });
        }
        results.push({
            "key": "_requestType",
            "value": "Library Load",
            "hidden": true,
        });

        return results;
    }
}

/**
 * Ensighten Server Side
 * https://cheq.ai/ensighten/enterprise-tag-management/
 *
 * @class
 * @extends BaseProvider
 */
class EnsightenServerSideProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "ENSIGHTENSST";
        this._pattern    = /\/sst\/?\?sstVersion=/;
        this._name       = "Ensighten Server Side";
        this._type       = "tagmanager";
        this._keywords   = ["tms", "cheq", "sst", "server side"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "omnibug_account",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "events",
                "name": "Events"
            },
            {
                "key": "dataLayer",
                "name": "Data Layer"
            }
        ];
    }

    /**
     * Get all the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "sstVersion": {
                "name": "Library Version",
                "group": "other"
            },
            "settings.nexusHost": {
                "name": "Library Hostname",
                "group": "other"
            },
            "settings.publishPath": {
                "name": "Library Publish Path",
                "group": "other"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^virtualBrowser\./.test(name)) {
            result = {
                "key":   name,
                "field": name.replace("virtualBrowser.", "Browser "),
                "value": value,
                "group": "other"
            };
        } else if(/^dataLayer\./.test(name)) {
            result = {
                "key":   name,
                "field": name.replace("dataLayer.", ""),
                "value": value,
                "group": "dataLayer"
            };
        } else if(/^events\[(\d+)]\.(.+)$/.test(name)) {
            const eventNumber = (parseInt(RegExp.$1) || 0) + 1;
            if(RegExp.$2 === "name") {
                result = {
                    "key":   name,
                    "field": `Event ${eventNumber} Name`,
                    "value": value,
                    "group": "events"
                };
            } else {
                result = {
                    "key":   name,
                    "field": `Event ${eventNumber} ${RegExp.$2.replace("data.", "")}`,
                    "value": value,
                    "group": "events"
                };
            }
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matches =  url.pathname.match(/^\/pc\/([^/]+)\/sst/),
            results = [];
        /* istanbul ignore else */
        if(matches !== null) {
            results.push({
                "key":   "omnibug_account",
                "value": `${matches[1]}`,
                "hidden": true
            });
            results.push({
                "key":   "profile",
                "field": "Profile",
                "value": matches[1],
                "group": "general"
            });
        }

        return results;
    }
}

/**
 * Facebook Pixel
 * https://developers.facebook.com/docs/facebook-pixel
 *
 * @class
 * @extends BaseProvider
 */
class FacebookPixelProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "FACEBOOKPIXEL";
        this._pattern    = /facebook\.com\/tr\/?(?!.*&ev=microdata)\?/i;
        this._name       = "Facebook Pixel";
        this._type       = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "id",
            "requestType":  "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "custom",
                "name": "Event Data"
            },
            {
                "key": "products",
                "name": "Products"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "id": {
                "name": "Account ID",
                "group": "general"
            },
            "ev": {
                "name": "Event Type",
                "group": "general"
            },
            "dl": {
                "name": "Page URL",
                "group": "general"
            },
            "rl": {
                "name": "Referring URL",
                "group": "general"
            },
            "ts": {
                "name": "Timestamp",
                "group": "general"
            },
            "sw": {
                "name": "Screen Width",
                "group": "other"
            },
            "sh": {
                "name": "Screen Height",
                "group": "other"
            },
            "v": {
                "name": "Pixel Version",
                "group": "other"
            },
            "ec": {
                "name": "Event Count",
                "group": "other"
            },
            "if": {
                "name": "In an iFrame",
                "group": "other"
            },
            "it": {
                "name": "Initialized Timestamp",
                "group": "other"
            },
            "r": {
                "name": "Code Branch",
                "group": "other"
            },
            "cd[content_name]": {
                "name": "Content Name",
                "group": "custom"
            },
            "cd[content_category]": {
                "name": "Content Category",
                "group": "custom"
            },
            "cd[content_ids]": {
                "name": "Product IDs",
                "group": "products"
            },
            "cd[content_type]": {
                "name": "Content Type",
                "group": "custom"
            },
            "cd[num_items]": {
                "name": "Quantity",
                "group": "custom"
            },
            "cd[search_string]": {
                "name": "Search Keyword",
                "group": "custom"
            },
            "cd[status]": {
                "name": "Registration Status",
                "group": "custom"
            },
            "cd[value]": {
                "name": "Value",
                "group": "custom"
            },
            "cd[currency]": {
                "name": "Currency",
                "group": "custom"
            },
            "ud[uid]": {
                "name": "User ID",
                "group": "general"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(name === "cd[contents]") {
            // do handling in custom
        } else if(!this.keys[name] && name.indexOf("cd[") === 0) {
            result = {
                "key":   name,
                "field": name.replace(/^cd\[|\]$/g, ""),
                "value": value,
                "group": "custom"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            content = params.get("cd[contents]"),
            requestType = params.get("ev") || "";
        if(content) {
            try {
                let jsonData = JSON.parse(content);
                if(jsonData && jsonData.length) {
                    let keyMapping = {
                        "id": "ID",
                        "item_price": "Price",
                        "quantity": "Quantity"
                    };
                    jsonData.forEach((product, index) => {
                        Object.entries(product).forEach(([key, value]) => {
                            results.push({
                                "key": `cd[contents][${index}][${key}]`,
                                "field": `Product ${index+1} ${keyMapping[key] || key}`,
                                "value": value,
                                "group": "products"
                            });
                        });
                    });
                }
            } catch(e) {
                results.push({
                    "key": "cd[contents]",
                    "field": "Content",
                    "value": content,
                    "group": "products"
                });
            }
        }

        results.push({
            "key":   "requestType",
            "value": requestType.split(/(?=[A-Z])/).join(" "),
            "hidden": true
        });
        return results;
    }
}
/**
 * Full Story
 * https://www.fullstory.com/
 * https://developer.fullstory.com/browser/getting-started/

 *
 * @class
 * @extends BaseProvider
 */

class FullStoryProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "FULLSTORY";
        this._pattern   = /edge\.fullstory\.com\/s\/fs\.js/;
        this._name      = "FullStory";
        this._type      = "replay";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "requestType":  "requestTypeParsed"
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        return [{
            "key":   "requestTypeParsed",
            "value": "Library Load",
            "hidden": true,
        }];
    }
}

/**
 * Glassbox
 *
 * @class
 * @extends BaseProvider
 */

class GlassboxProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "GLASSBOX";
        this._pattern   = /\/cls_report\/?\?clsjsv=/;
        this._name      = "Glassbox";
        this._type      = "replay";
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "event",
                "name": "Event Data"
            },
            {
                "key": "configuration",
                "name": "Configuration"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "clsjsv" : {
                "name": "Library Version",
                "group": "other"
            },
            "r" : {
                "name": "Referrer",
                "group": "general"
            },
            "seg" : {
                "name": "Page",
                "group": "general"
            },
            "_cls_s" : {
                "name": "Session Cookie",
                "group": "general"
            },
            "_cls_v" : {
                "name": "Video Cookie",
                "group": "general"
            },
            "pid" : {
                "name": "Page ID",
                "group": "general"
            },
            "p" : {
                "name": "Page ID",
                "group": "other"
            },
            "e" : {
                "name": "Event Data",
                "group": "event"
            },
        };
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "") {
        let params = [];
        // Handle POST data first, if applicable (treat as query params)
        if (typeof postData === "string" && postData !== "") {
            let keyPairs = postData.split("&");
            keyPairs.forEach((keyPair) => {
                let splitPair = keyPair.split("=");
                params.push([splitPair[0], decodeURIComponent(splitPair[1] || "")]);
            });
        } else if (typeof postData === "object") {
            Object.entries(postData).forEach((entry) => {
                // @TODO: consider handling multiple values passed?
                params.push([entry[0], entry[1].toString()]);
            });
        }
        return params;
    }
}

/**
 * Google Ads
 * https://ads.google.com/
 *
 * @class
 * @extends BaseProvider
 */
class GoogleAdsProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "GOOGLEADS";
        // Match the legacy /pagead/conversion and /pagead/viewthroughconversion
        // endpoints AND the modern /ccm/collect endpoint used by Google Ads / Google Tag.
        this._pattern = /\/pagead\/(?:viewthrough)?conversion|\/ccm\/collect/;
        this._name = "Google Ads";
        this._type = "marketing";
        this._keywords = ["aw", "ad words"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "omnibug-account",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "url": {
                "name": "Page URL",
                "group": "general"
            },
            "tiba": {
                "name": "Page Title",
                "group": "general"
            },
            "data": {
                "name": "Event Data",
                "group": "general"
            },
            "label": {
                "name": "Conversion Label",
                "group": "general"
            },
            "gcs": {
                "name": "Consent Mode",
                "group": "general"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            requestType = "";

        // Two URL shapes are now supported:
        //   1) /pagead/conversion/AW-12345/  (legacy)
        //   2) /ccm/collect                  (modern Google Tag / Google Ads)
        // The legacy shape carries the account ID in the path; the modern one
        // carries it in `tids` or `tid` query params.
        const isCcm = /\/ccm\/collect/.test(url.pathname);

        let account = "";
        let pathParts = null;

        if (isCcm) {
            // /ccm/collect: extract account from `tid` or `tids` query params
            const tid = params.get("tid") || params.get("tids");
            if (tid) {
                // tid may already include the AW- prefix; if not, add it
                account = /^AW-/i.test(tid) ? tid : "AW-" + tid;
            }
        } else {
            // Legacy /pagead/(viewthrough)?conversion/AW-12345/ pattern
            pathParts = url.pathname.match(/\/([^/]+)\/(?:AW-)?(\d+)\/?$/);
            if (pathParts && pathParts[2]) {
                account = "AW-" + pathParts[2];
            }
        }

        const data = params.get("data") || "";
        const dataEvent = data.match(/event=([^;]+)(?:$|;)/);

        if (account) {
            results.push({
                "key": "account",
                "field": "Account ID",
                "value": account,
                "group": "general"
            });

            // Add the conversion label, if available, to the accounts column
            if (params.get("label")) {
                account += "/" + params.get("label");
            }
            results.push({
                "key": "omnibug-account",
                "value": account,
                "hidden": true
            });
        }

        if (dataEvent && dataEvent.length) {
            if (dataEvent[1] === "gtag.config") {
                requestType = "Page View";
            } else {
                requestType = dataEvent[1];
            }
        } else if (isCcm) {
            // For /ccm/collect, the event name is in `en` (Google Tag style)
            const en = params.get("en");
            if (en === "page_view" || en === "pageview") {
                requestType = "Page View";
            } else if (en) {
                requestType = en;
            } else {
                requestType = "Collect";
            }
        } else if (pathParts && pathParts[1]) {
            requestType = (pathParts[1] === "viewthroughconversion") ? "Conversion" : pathParts[1].replace("viewthrough", "");
        } else {
            requestType = "Conversion";
        }

        results.push({
            "key": "requestType",
            "value": requestType,
            "field": "Request Type",
            "group": "general"
        });

        return results;
    }
}

/**
 * Google Universal Analytics
 * https://developers.google.com/analytics/devguides/collection/analyticsjs/
 *
 * @class
 * @extends BaseProvider
 */
class GoogleAnalyticsProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "UNIVERSALANALYTICS";
        this._pattern    = /(?:\.google-analytics|analytics\.google)\.com\/([^g]\/)?collect(?:[/#?]+(?!.*consentMode=)|$)/;
        this._name       = "Google Universal Analytics";
        this._type       = "analytics";
        this._keywords   = ["google", "google analytics", "ua", "ga"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "tid",
            "requestType": "omnibug_requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "campaign",
                "name": "Campaign"
            },
            {
                "key": "events",
                "name": "Events"
            },
            {
                "key": "ecommerce",
                "name": "Ecommerce"
            },
            {
                "key": "timing",
                "name": "Timing"
            },
            {
                "key": "dimension",
                "name": "Custom Dimensions"
            },
            {
                "key": "metric",
                "name": "Custom Metrics"
            },
            {
                "key": "promo",
                "name": "Promotions"
            },
            {
                "key": "optimize",
                "name": "Google Optimize"
            },
            {
                "key": "contentgroup",
                "name": "Content Group"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "v": {
                "name": "Protocol Version",
                "group": "general"
            },
            "tid": {
                "name": "Tracking ID",
                "group": "general"
            },
            "aip": {
                "name": "Anonymize IP",
                "group": "general"
            },
            "qt": {
                "name": "Queue Time",
                "group": "general"
            },
            "z": {
                "name": "Cache Buster",
                "group": "general"
            },
            "cid": {
                "name": "Client ID",
                "group": "general"
            },
            "sc": {
                "name": "Session Control",
                "group": "general"
            },
            "dr": {
                "name": "Document Referrer",
                "group": "general"
            },
            "cn": {
                "name": "Campaign Name",
                "group": "campaign"
            },
            "cs": {
                "name": "Campaign Source",
                "group": "campaign"
            },
            "cm": {
                "name": "Campaign Medium",
                "group": "campaign"
            },
            "ck": {
                "name": "Campaign Keyword",
                "group": "campaign"
            },
            "cc": {
                "name": "Campaign Content",
                "group": "campaign"
            },
            "ci": {
                "name": "Campaign ID",
                "group": "campaign"
            },
            "gclid": {
                "name": "Google AdWords ID",
                "group": "campaign"
            },
            "dclid": {
                "name": "Google Display Ads ID",
                "group": "campaign"
            },
            "sr": {
                "name": "Screen Resolution",
                "group": "general"
            },
            "vp": {
                "name": "Viewport Size",
                "group": "general"
            },
            "de": {
                "name": "Document Encoding",
                "group": "general"
            },
            "sd": {
                "name": "Screen Colors",
                "group": "general"
            },
            "ul": {
                "name": "User Language",
                "group": "general"
            },
            "je": {
                "name": "Java Enabled",
                "group": "general"
            },
            "fl": {
                "name": "Flash Version",
                "group": "general"
            },
            "t": {
                "name": "Hit Type",
                "group": "general"
            },
            "en": {
                "name": "Hit Type",
                "group": "general"
            },
            "ni": {
                "name": "Non-Interaction Hit",
                "group": "events"
            },
            "dl": {
                "name": "Document location URL",
                "group": "general"
            },
            "dh": {
                "name": "Document Host Name",
                "group": "general"
            },
            "dp": {
                "name": "Document Path",
                "group": "general"
            },
            "dt": {
                "name": "Document Title",
                "group": "general"
            },
            "cd": {
                "name": "Content Description",
                "group": "general"
            },
            "an": {
                "name": "Application Name",
                "group": "general"
            },
            "av": {
                "name": "Application Version",
                "group": "general"
            },
            "ec": {
                "name": "Event Category",
                "group": "events"
            },
            "ea": {
                "name": "Event Action",
                "group": "events"
            },
            "el": {
                "name": "Event Label",
                "group": "events"
            },
            "ev": {
                "name": "Event Value",
                "group": "events"
            },
            "ti": {
                "name": "Transaction ID",
                "group": "ecommerce"
            },
            "ta": {
                "name": "Transaction Affiliation",
                "group": "ecommerce"
            },
            "tr": {
                "name": "Transaction Revenue",
                "group": "ecommerce"
            },
            "ts": {
                "name": "Transaction Shipping",
                "group": "ecommerce"
            },
            "tt": {
                "name": "Transaction Tax",
                "group": "ecommerce"
            },
            "in": {
                "name": "Item Name",
                "group": "ecommerce"
            },
            "ip": {
                "name": "Item Price",
                "group": "ecommerce"
            },
            "iq": {
                "name": "Item Quantity",
                "group": "ecommerce"
            },
            "ic": {
                "name": "Item Code",
                "group": "ecommerce"
            },
            "iv": {
                "name": "Item Category",
                "group": "ecommerce"
            },
            "cu": {
                "name": "Currency Code",
                "group": "ecommerce"
            },
            "sn": {
                "name": "Social Network",
                "group": "events"
            },
            "sa": {
                "name": "Social Action",
                "group": "events"
            },
            "st": {
                "name": "Social Action Target",
                "group": "events"
            },
            "utc": {
                "name": "User Timing Category",
                "group": "timing"
            },
            "utv": {
                "name": "User Timing Variable Name",
                "group": "timing"
            },
            "utt": {
                "name": "User Timing Time",
                "group": "timing"
            },
            "utl": {
                "name": "User timing Label",
                "group": "timing"
            },
            "plt": {
                "name": "Page load time",
                "group": "timing"
            },
            "dns": {
                "name": "DNS time",
                "group": "timing"
            },
            "pdt": {
                "name": "Page download time",
                "group": "timing"
            },
            "rrt": {
                "name": "Redirect response time",
                "group": "timing"
            },
            "tcp": {
                "name": "TCP connect time",
                "group": "timing"
            },
            "srt": {
                "name": "Server response time",
                "group": "timing"
            },
            "exd": {
                "name": "Exception description",
                "group": "events"
            },
            "exf": {
                "name": "Is exception fatal?",
                "group": "events"
            },
            "ds": {
                "name": "Data Source",
                "group": "general"
            },
            "uid": {
                "name": "User ID",
                "group": "general"
            },
            "linkid": {
                "name": "Link ID",
                "group": "general"
            },
            "pa": {
                "name": "Product Action",
                "group": "ecommerce"
            },
            "tcc": {
                "name": "Coupon Code",
                "group": "ecommerce"
            },
            "pal": {
                "name": "Product Action List",
                "group": "ecommerce"
            },
            "cos": {
                "name": "Checkout Step",
                "group": "ecommerce"
            },
            "col": {
                "name": "Checkout Step Option",
                "group": "ecommerce"
            },
            "promoa": {
                "name": "Promotion Action",
                "group": "ecommerce"
            },
            "xid": {
                "name": "Content Experiment ID",
                "group": "optimize"
            },
            "xvar": {
                "name": "Content Experiment Variant",
                "group": "optimize"
            },
            "_r": {
                "name": "Display Features Enabled",
                "group": "general"
            },
            "requestType": {
                "hidden": true
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^cd(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": `Custom Dimension ${RegExp.$1}`,
                "value": value,
                "group": "dimension"
            };
        } else if(/^cm(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": `Custom Metric ${RegExp.$1}`,
                "value": value,
                "group": "metric"
            };
        } else if(/^cg(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": `Content Group ${RegExp.$1}`,
                "value": value,
                "group": "contentgroup"
            };
        } else if(/^promo(\d+)([a-z]{2})$/i.test(name)) {
            let lookup = {
                    "id": "ID",
                    "nm": "Name",
                    "cr": "Creative",
                    "ps": "Position"
                },
                type = lookup[RegExp.$2] || "";
            result = {
                "key":   name,
                "field": `Promotion ${RegExp.$1} ${type}`,
                "value": value,
                "group": "promo"
            };
        } else if(/^pr(\d+)([a-z]{2})$/i.test(name)) {
            let lookup = {
                    "id": "ID",
                    "nm": "Name",
                    "br": "Brand",
                    "ca": "Category",
                    "va": "Variant",
                    "pr": "Price",
                    "qt": "Quantity",
                    "cc": "Coupon Code",
                    "ps": "Position"
                },
                type = lookup[RegExp.$2] || "";
            result = {
                "key":   name,
                "field": `Product ${RegExp.$1} ${type}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^pr(\d+)(cd|cm)(\d+)$/i.test(name)) {
            let lookup = {
                    "cd": "Dimension",
                    "cm": "Metric"
                },
                type = lookup[RegExp.$2] || "";
            result = {
                "key":   name,
                "field": `Product ${RegExp.$1} ${type} ${RegExp.$3}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^il(\d+)nm$/i.test(name)) {
            result = {
                "key":   name,
                "field": `Impression List ${RegExp.$1}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^il(\d+)pi(\d+)(cd|cm)(\d+)$/i.test(name)) {
            let lookup = {
                    "cd": "Dimension",
                    "cm": "Metric"
                },
                type = lookup[RegExp.$3] || "";
            result = {
                "key":   name,
                "field": `Impression List ${RegExp.$1} Product ${RegExp.$2} ${type} ${RegExp.$4}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^il(\d+)pi(\d+)([a-z]{2})$/i.test(name)) {
            let lookup = {
                    "id": "ID",
                    "nm": "Name",
                    "br": "Brand",
                    "ca": "Category",
                    "va": "Variant",
                    "pr": "Price",
                    "ps": "Position"
                },
                type = lookup[RegExp.$3] || "";
            result = {
                "key": name,
                "field": `Impression List ${RegExp.$1} Product ${RegExp.$2} ${type}`,
                "value": value,
                "group": "ecommerce"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "") {
        let params = [];
        // Handle POST data first, if applicable (treat as query params)
        if (typeof postData === "string" && postData !== "") {
            const keyPairs = postData.split("&");
            keyPairs.forEach((keyPair) => {
                const splitPair = keyPair.split("=");
                params.push([splitPair[0], decodeURIComponent(splitPair[1] || "")]);
            });
        } else if (typeof postData === "object") {
            Object.entries(postData).forEach((entry) => {
                // @TODO: consider handling multiple values passed?
                params.push([entry[0], entry[1].toString()]);
            });
        }
        return params;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {object}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            hitType = params.get("t")  || "Page View",
            requestType = "";

        results.push({
            "key":    "omnibug_hostname",
            "value":  url.hostname,
            "field":   "Google Analytics Host",
            "group":  "general"
        });

        hitType = hitType.toLowerCase();
        if(hitType === "pageview" || hitType === "screenview" || hitType === "page_view") {
            requestType = "Page View";
        } else if(hitType === "transaction" || hitType === "item") {
            requestType = "Ecommerce " + hitType.charAt(0).toUpperCase() + hitType.slice(1);
        } else if(hitType.indexOf("_")) {
            requestType = hitType.replace(/_/g, " ");
        } else {
            requestType = hitType.charAt(0).toUpperCase() + hitType.slice(1);
        }
        results.push({
            "key":    "omnibug_requestType",
            "value":  requestType,
            "hidden": true
        });

        return results;
    }
}

/**
 * Google Analytics 4
 * https://developers.google.com/analytics/devguides/collection/ga4
 *
 * @class
 * @extends BaseProvider
 */
class GoogleAnalytics4Provider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "GOOGLEANALYTICS4";
        // Match all known GA4 collect endpoints, including server-side setups with
        // custom paths (e.g. example.com/track/g/collect, sgtm.example.com/g/collect).
        // Endpoints supported:
        //   /g/collect              — standard client-side
        //   /g/s/collect            — server-side via Google's regional analytics domains
        //                            (e.g. region1.analytics.google.com/g/s/collect)
        //   /mp/collect             — Measurement Protocol (server-to-server)
        //   /r/collect              — legacy redirect endpoint
        // The (?:\/[^\/?#]+)* allows any number of path segments BEFORE /g/collect,
        // so custom sGTM mounts (e.g. /<custom-path>/g/collect) are matched.
        // Excludes clarity.ms, transcend.io, and *.doubleclick.net.
        this._defaultPattern = /https?:\/\/([^/]+)(?<!(clarity\.ms|transcend\.io)|(\.doubleclick\.net))(?:\/[^/?#]+)*\/(?:g(?:\/s)?|mp|r)\/collect(?:[/#?]|$)/;
        this._pattern    = this._defaultPattern;
        this._name       = "Google Analytics 4";
        this._type       = "analytics";
        this._keywords   = ["google", "google analytics", "app+web", "app web", "a+w", "ga4"];
    }

    /**
     * Escape regex special characters in a user-provided string so it can be
     * safely embedded into a RegExp as a literal substring.
     *
     * @param {string} str
     * @returns {string}
     */
    static escapeRegex(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /**
     * Update the provider's pattern to include user-defined server-side
     * endpoints in addition to the default `/g/collect` pattern.
     *
     * @param {string[]} patterns  List of raw domain/path strings entered by the user
     */
    setCustomPatterns(patterns) {
        const cleaned = (Array.isArray(patterns) ? patterns : [])
            .map((p) => typeof p === "string" ? p.trim() : "")
            .filter((p) => p.length > 0);

        if (cleaned.length === 0) {
            this._pattern = this._defaultPattern;
            return;
        }

        // Build a combined pattern: default OR (any of the escaped custom strings)
        const escaped = cleaned.map((p) => GoogleAnalytics4Provider.escapeRegex(p));
        const combined = this._defaultPattern.source + "|" + escaped.join("|");
        this._pattern = new RegExp(combined, "i");
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "tid",
            "requestType": "omnibug_requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "campaign",
                "name": "Campaign"
            },
            {
                "key": "events",
                "name": "Events"
            },
            {
                "key": "ecommerce",
                "name": "Ecommerce"
            },
            {
                "key": "timing",
                "name": "Timing"
            },
            {
                "key": "promo",
                "name": "Promotions"
            },
            {
                "key": "contentgroup",
                "name": "Content Group"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "v": {
                "name": "Protocol Version",
                "group": "general"
            },
            "tid": {
                "name": "Tracking ID",
                "group": "general"
            },
            "aip": {
                "name": "Anonymize IP",
                "group": "general"
            },
            "qt": {
                "name": "Queue Time",
                "group": "general"
            },
            "z": {
                "name": "Cache Buster",
                "group": "general"
            },
            "cid": {
                "name": "Client ID",
                "group": "general"
            },
            "sc": {
                "name": "Session Control",
                "group": "general"
            },
            "dr": {
                "name": "Document Referrer",
                "group": "general"
            },
            "cn": {
                "name": "Campaign Name",
                "group": "campaign"
            },
            "cs": {
                "name": "Campaign Source",
                "group": "campaign"
            },
            "cm": {
                "name": "Campaign Medium",
                "group": "campaign"
            },
            "ck": {
                "name": "Campaign Keyword",
                "group": "campaign"
            },
            "cc": {
                "name": "Campaign Content",
                "group": "campaign"
            },
            "ci": {
                "name": "Campaign ID",
                "group": "campaign"
            },
            "gclid": {
                "name": "Google AdWords ID",
                "group": "campaign"
            },
            "dclid": {
                "name": "Google Display Ads ID",
                "group": "campaign"
            },
            "sr": {
                "name": "Screen Resolution",
                "group": "general"
            },
            "vp": {
                "name": "Viewport Size",
                "group": "general"
            },
            "de": {
                "name": "Document Encoding",
                "group": "general"
            },
            "sd": {
                "name": "Screen Colors",
                "group": "general"
            },
            "ul": {
                "name": "User Language",
                "group": "general"
            },
            "je": {
                "name": "Java Enabled",
                "group": "general"
            },
            "fl": {
                "name": "Flash Version",
                "group": "general"
            },
            "t": {
                "name": "Hit Type",
                "group": "general"
            },
            "en": {
                "name": "Hit Type",
                "group": "general"
            },
            "ni": {
                "name": "Non-Interaction Hit",
                "group": "events"
            },
            "dl": {
                "name": "Document location URL",
                "group": "general"
            },
            "dh": {
                "name": "Document Host Name",
                "group": "general"
            },
            "dp": {
                "name": "Document Path",
                "group": "general"
            },
            "dt": {
                "name": "Document Title",
                "group": "general"
            },
            "cd": {
                "name": "Content Description",
                "group": "general"
            },
            "an": {
                "name": "Application Name",
                "group": "general"
            },
            "av": {
                "name": "Application Version",
                "group": "general"
            },
            "ec": {
                "name": "Event Category",
                "group": "events"
            },
            "ea": {
                "name": "Event Action",
                "group": "events"
            },
            "el": {
                "name": "Event Label",
                "group": "events"
            },
            "ev": {
                "name": "Event Value",
                "group": "events"
            },
            "ti": {
                "name": "Traffic Type",
                "group": "general"
            },
            "ta": {
                "name": "Transaction Affiliation",
                "group": "ecommerce"
            },
            "tr": {
                "name": "Transaction Revenue",
                "group": "ecommerce"
            },
            "ts": {
                "name": "Transaction Shipping",
                "group": "ecommerce"
            },
            "tt": {
                "name": "Traffic Type",
                "group": "general"
            },
            "in": {
                "name": "Item Name",
                "group": "ecommerce"
            },
            "ip": {
                "name": "Item Price",
                "group": "ecommerce"
            },
            "iq": {
                "name": "Item Quantity",
                "group": "ecommerce"
            },
            "ic": {
                "name": "Item Code",
                "group": "ecommerce"
            },
            "iv": {
                "name": "Item Category",
                "group": "ecommerce"
            },
            "cu": {
                "name": "Currency Code",
                "group": "ecommerce"
            },
            "sn": {
                "name": "Social Network",
                "group": "events"
            },
            "sa": {
                "name": "Social Action",
                "group": "events"
            },
            "st": {
                "name": "Social Action Target",
                "group": "events"
            },
            "utc": {
                "name": "User Timing Category",
                "group": "timing"
            },
            "utv": {
                "name": "User Timing Variable Name",
                "group": "timing"
            },
            "utt": {
                "name": "User Timing Time",
                "group": "timing"
            },
            "utl": {
                "name": "User timing Label",
                "group": "timing"
            },
            "plt": {
                "name": "Page load time",
                "group": "timing"
            },
            "dns": {
                "name": "DNS time",
                "group": "timing"
            },
            "pdt": {
                "name": "Page download time",
                "group": "timing"
            },
            "rrt": {
                "name": "Redirect response time",
                "group": "timing"
            },
            "tcp": {
                "name": "TCP connect time",
                "group": "timing"
            },
            "srt": {
                "name": "Server response time",
                "group": "timing"
            },
            "exd": {
                "name": "Exception description",
                "group": "events"
            },
            "exf": {
                "name": "Is exception fatal?",
                "group": "events"
            },
            "ds": {
                "name": "Data Source",
                "group": "general"
            },
            "uid": {
                "name": "User ID",
                "group": "general"
            },
            "linkid": {
                "name": "Link ID",
                "group": "general"
            },
            "pa": {
                "name": "Product Action",
                "group": "ecommerce"
            },
            "tcc": {
                "name": "Coupon Code",
                "group": "ecommerce"
            },
            "pal": {
                "name": "Product Action List",
                "group": "ecommerce"
            },
            "cos": {
                "name": "Checkout Step",
                "group": "ecommerce"
            },
            "col": {
                "name": "Checkout Step Option",
                "group": "ecommerce"
            },
            "promoa": {
                "name": "Promotion Action",
                "group": "ecommerce"
            },
            "_r": {
                "name": "Display Features Enabled",
                "group": "general"
            },
            "gcs": {
                "name": "Consent Mode",
                "group": "general"
            },
            "requestType": {
                "hidden": true
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^en\[(\d+)]$/.test(name)) {
            const eventKey = parseInt(RegExp.$1, 10) + 1;
            result = {
                "key":   name,
                "field": `Event ${eventKey} Type`,
                "value": value,
                "group": "events"
            };
        } else if(/^epn?\[(\d+)]\.(.+)$/.test(name)) {
            const eventKey = parseInt(RegExp.$1, 10) + 1;
            result = {
                "key":   name,
                "field": `Event ${eventKey} Data (${RegExp.$2})`,
                "value": value,
                "group": "events"
            };
        } else if(/^epn?\.(.+)$/.test(name)) {
            result = {
                "key":   name,
                "field": `Event Data (${RegExp.$1})`,
                "value": value,
                "group": "events"
            };
        } else if(/^cg(\d+)$/i.test(name)) {
            result = {
                "key":   name,
                "field": `Content Group ${RegExp.$1}`,
                "value": value,
                "group": "contentgroup"
            };
        } else if(/^promo(\d+)([a-z]{2})$/i.test(name)) {
            let lookup = {
                    "id": "ID",
                    "nm": "Name",
                    "cr": "Creative",
                    "ps": "Position"
                },
                type = lookup[RegExp.$2] || "";
            result = {
                "key":   name,
                "field": `Promotion ${RegExp.$1} ${type}`,
                "value": value,
                "group": "promo"
            };
        } else if(/^pr(\d+)([a-z]{2})$/i.test(name)) {
            let lookup = {
                    "id": "ID",
                    "nm": "Name",
                    "br": "Brand",
                    "ca": "Category",
                    "va": "Variant",
                    "pr": "Price",
                    "qt": "Quantity",
                    "cc": "Coupon Code",
                    "ps": "Position"
                },
                type = lookup[RegExp.$2] || "";
            result = {
                "key":   name,
                "field": `Product ${RegExp.$1} ${type}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^pr(\d+)(cd|cm)(\d+)$/i.test(name)) {
            let lookup = {
                    "cd": "Dimension",
                    "cm": "Metric"
                },
                type = lookup[RegExp.$2] || "";
            result = {
                "key":   name,
                "field": `Product ${RegExp.$1} ${type} ${RegExp.$3}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^il(\d+)nm$/i.test(name)) {
            result = {
                "key":   name,
                "field": `Impression List ${RegExp.$1}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^il(\d+)pi(\d+)(cd|cm)(\d+)$/i.test(name)) {
            let lookup = {
                    "cd": "Dimension",
                    "cm": "Metric"
                },
                type = lookup[RegExp.$3] || "";
            result = {
                "key":   name,
                "field": `Impression List ${RegExp.$1} Product ${RegExp.$2} ${type} ${RegExp.$4}`,
                "value": value,
                "group": "ecommerce"
            };
        } else if(/^il(\d+)pi(\d+)([a-z]{2})$/i.test(name)) {
            let lookup = {
                    "id": "ID",
                    "nm": "Name",
                    "br": "Brand",
                    "ca": "Category",
                    "va": "Variant",
                    "pr": "Price",
                    "ps": "Position"
                },
                type = lookup[RegExp.$3] || "";
            result = {
                "key": name,
                "field": `Impression List ${RegExp.$1} Product ${RegExp.$2} ${type}`,
                "value": value,
                "group": "ecommerce"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "") {
        let params = [];
        // Handle POST data first, if applicable (treat as query params)
        if (typeof postData === "string" && postData !== "") {
            if(/^en=/.test(postData)) {
                const events = postData.split(/\s+/);
                let eventNumber = 0;
                events.forEach((event) => {
                    const eventParams = event.split("&");
                    eventParams.forEach((eventParam) => {
                        const splitPair = eventParam.split("=");
                        const eventKey = splitPair[0].split(".");
                        eventKey[0] = `${eventKey[0]}[${eventNumber}]`;
                        params.push([eventKey.join("."), decodeURIComponent(splitPair[1] || "")]);
                    });
                    eventNumber++;
                });
            } else {
                const keyPairs = postData.split("&");
                keyPairs.forEach((keyPair) => {
                    const splitPair = keyPair.split("=");
                    params.push([splitPair[0], decodeURIComponent(splitPair[1] || "")]);
                });
            }
        } else if (typeof postData === "object") {
            Object.entries(postData).forEach((entry) => {
                // @TODO: consider handling multiple values passed?
                params.push([entry[0], entry[1].toString()]);
            });
        }
        return params;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {object}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            requestType = "";

        results.push({
            "key":    "omnibug_hostname",
            "value":  url.hostname,
            "field":   "Google Analytics Host",
            "group":  "general"
        });

        const types = Array.from(params.entries())
            .filter(([key, hitType]) => {
                return key === "t" || key === "en" || /en\[\d+]/.test(key);
            }).map(([key, hitType]) => {
                let requestType;
                hitType = hitType.toLowerCase();
                if(hitType === "pageview" || hitType === "screenview" || hitType === "page_view") {
                    requestType = "Page View";
                } else if(hitType.indexOf("_")) {
                    requestType = hitType.replace(/_/g, " ");
                } else {
                    requestType = hitType.charAt(0).toUpperCase() + hitType.slice(1);
                }
                return requestType;
            });

        if(types.length > 1) {
            requestType = `(${types.length}) ${types.join(", ")}`;
        } else if(types.length === 1) {
            requestType = types.pop();
        } else {
            requestType = "Other";
        }

        results.push({
            "key":    "omnibug_requestType",
            "value":  requestType,
            "hidden": true
        });

        return results;
    }
}

/**
 * Google DoubleClick
 * https://marketingplatform.google.com/about/enterprise/
 *
 * @class
 * @extends BaseProvider
 */
class GoogleDoubleClickProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "DOUBLECLICK";
        this._pattern    = /(?:fls|ad)\.doubleclick\.net\/activityi(?!.*dc_pre);/;
        this._name       = "Google DoubleClick";
        this._type       = "marketing";
        this._keywords   = ["dc", "dcm"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "omnibug-account",
            "requestType":  "type"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "custom",
                "name": "Custom Fields"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "src": {
                "name": "Account ID",
                "group": "general"
            },
            "type": {
                "name": "Activity Group",
                "group": "general"
            },
            "cat": {
                "name": "Activity Tag",
                "group": "general"
            },
            "cost": {
                "name": "Value",
                "group": "general"
            },
            "qty": {
                "name": "Quantity",
                "group": "general"
            },
            "num": {
                "name": "Request Cache Buster",
                "group": "other"
            },
            "dc_lat": {
                "name": "Limit Ad Tracking",
                "group": "other"
            },
            "tag_for_child_directed_treatment": {
                "name": "COPPA Request",
                "group": "other"
            },
            "tfua": {
                "name": "User Underage",
                "group": "other"
            },
            "npa": {
                "name": "Opt-out of Remarketing",
                "group": "other"
            },
            "ord": {
                "hidden": true
            }
        };
    }

    /**
     * Parse a given URL into human-readable output
     *
     * @param {string}  rawUrl      A URL to check against
     * @param {string}  postData    POST data, if applicable
     *
     * @return {{provider: {name: string, key: string, type: string}, data: Array}}
     */
    parseUrl(rawUrl, postData = "")
    {
        let url = new URL(rawUrl),
            data = [],
            params = new URLSearchParams(url.search);

        // Force Google's path into query strings
        url.pathname.replace("/activityi;", "").split(";").forEach(param => {
            let pair = param.split("=");
            params.append(pair[0], pair[1]);
        });
        for(let param of params)
        {
            let key = param[0],
                value = param[1],
                result = this.handleQueryParam(key, value);
            if(typeof result === "object") {
                data.push(result);
            }
        }

        let customData = this.handleCustom(url, params);
        /* istanbul ignore else */
        if(typeof customData === "object" && customData !== null)
        {
            data = data.concat(customData);
        }

        return {
            "provider": {
                "name":    this.name,
                "key":     this.key,
                "type":    this.type,
                "columns": this.columnMapping,
                "groups":  this.groups
            },
            "data": data
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(/^u(\d+)$/i.test(name)) {
            result = {
                "key": name,
                "field": "Custom Field " + RegExp.$1,
                "value": value,
                "group": "custom"
            };
        } else if(name === "~oref") {
            result = {
                "key": name,
                "field": "Page URL",
                "value": decodeURIComponent(value),
                "group": "general"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            account = "DC-" + params.get("src"),
            ord = params.get("ord"),
            countingMethod = "per_session";

        if(ord) {
            if(params.get("qty")) {
                results.push({
                    "key":   "ord",
                    "field": "Transaction ID",
                    "value": ord,
                    "group": "general"
                });
                countingMethod = "transactions / items_sold";
            } else {
                results.push({
                    "key":   "ord",
                    "field": "Counting Method Type",
                    "value": ord,
                    "group": "other"
                });
                countingMethod = (ord === "1") ? "unique" : "standard";
            }
        }

        results.push({
            "key":   "countingMethod",
            "field": "Counting Method",
            "value": countingMethod,
            "group": "general"
        });

        // Add the type & category, if available, to the accounts column
        /* istanbul ignore else */
        if(params.get("type") && params.get("cat")) {
            account += "/" + params.get("type") + "/" + params.get("cat");
        }
        results.push({
            "key":   "omnibug-account",
            "value": account,
            "hidden": true
        });

        return results;
    }
}
/**
 * Google Tag Manager
 * https://tagmanager.google.com/
 *
 * @class
 * @extends BaseProvider
 */
class GoogleTagManagerProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "GOOGLETAGMAN";
        this._pattern    = /googletagmanager\.com\/gtm\.js/;
        this._name       = "Google Tag Manager";
        this._type       = "tagmanager";
        this._keywords   = ["tms"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "id",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "id": {
                "name": "Account ID",
                "group": "general"
            },
            "l": {
                "name": "Data Layer Variable",
                "group": "general"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        return [{
            "key": "_requestType",
            "value": "Library Load",
            "hidden": true,
        }];
    }
}

/**
 * Hotjar
 * https://www.hotjar.com/
 *
 * @class
 * @extends BaseProvider
 */
class HotjarProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "HOTJAR";
        this._pattern = /hotjar.com\/c\/hotjar-\d+\.js/;
        this._name = "Hotjar";
        this._type = "replay";
        this._keywords = ["heat map", "heatmap", "session record", "click"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account":     "account",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        return [
            {
                "key":   "account",
                "field": "Account ID",
                "value": url.pathname.match(/hotjar-(\d+)\.js/)[1],
                "group": "general"
            },
            {
                "key": "_requestType",
                "value": "Library Load",
                "hidden": true,
            }
        ];
    }
}

/**
 * Hubspot
 * https://knowledge.hubspot.com/reports/install-the-hubspot-tracking-code
 *
 * @class
 * @extends BaseProvider
 */

class HubspotProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "HUBSPOT";
        this._pattern   = /track\.hubspot\.com\/__ptq\.gif/;
        this._name      = "Hubspot";
        this._type      = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "a",
            "requestType":  "omnibug_requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "events",
                "name": "Event Data"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "ct" : {
                "name": "Content Type",
                "group": "general"
            },
            "pu" : {
                "name": "Page URL",
                "group": "general"
            },
            "t" : {
                "name": "Page Title",
                "group": "general"
            },
            "po" : {
                "name": "Page Path",
                "group": "general"
            },
            "id" : {
                "name": "Event Name",
                "group": "events"
            },
            "value" : {
                "name": "Event Value",
                "group": "events"
            },
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        return [
            {
                "key":   "omnibug_requestType",
                "value": params.get("id") ? params.get("id") : "Page View",
                "hidden": true
            }
        ];
    }
}

/**
 * Indicative
 * https://docs.mparticle.com/guides/analytics-deprecated/developer-docs/sdks/javascript/
 *
 * @class
 * @extends BaseProvider
 */

class IndicativeProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "INDICATIVE";
        this._pattern   = /api\.indicative.com\/service\/event/;
        this._name      = "Indicative";
        this._type      = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "apiKey",
            "requestType":  "eventName"
        };
    }
} // class

/**
 * Invoca
 * https://community.invoca.com/t5/developer-features/an-introduction-to-invocajs-the-technology-behind-your-invoca/ta-p/562
 *
 * @class
 * @extends BaseProvider
 */
class InvocaProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "INVOCA";
        this._pattern = /solutions\.invocacdn\.com\/.*\/tag-(draft|live)\.js/;
        this._name = "Invoca";
        this._type = "marketing";
        this._keywords = ["call"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account":     "account",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        const libraryType = url.pathname.match(/\/tag-([^.]+)\.js/)[1];
        return [
            {
                "key":   "account",
                "field": "Account ID",
                "value": url.pathname.match(/\/(\d+\/\d+)\/tag-/)[1],
                "group": "general"
            },
            {
                "key": "_requestType",
                "value": `Library Load (${libraryType})`,
                "hidden": true,
            }
        ];
    }
}

/**
 * LinkedIn Conversions
 * https://business.linkedin.com/marketing-solutions/insight-tag
 *
 * @class
 * @extends BaseProvider
 */
class LinkedInProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "LINKEDINPIXEL";
        this._pattern = /px\.ads\.linkedin\.com\/collect/;
        this._name = "LinkedIn Conversion";
        this._type = "marketing";
        this._keywords = ["li", "linkedin", "insight", "licdn"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "pid",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "pid": {
                "name": "Pixel ID",
                "group": "general"
            },
            "conversionId": {
                "name": "Conversion ID",
                "group": "other"
            },
            "time": {
                "name": "Timestamp",
                "group": "other"
            },
            "fmt": {
                "name": "Pixel Type",
                "group": "other"
            },
            "url": {
                "name": "Page URL",
                "group": "other"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            requestType = "Conversion";

        // @TODO: More pixel types are sent, but no public documentation for this :(
        results.push({
            "key": "requestType",
            "value": requestType,
            "field": "Request Type",
            "group": "general"
        });

        return results;
    }
}
/**
 * Lytics
 * https://learn.lytics.com/documentation/product/features/lytics-javascript-tag/using-version-2/installation-configuration
 * https://learn.lytics.com/documentation/product/features/lytics-javascript-tag/using-version-3/installation-configuration
 * https://learn.lytics.com/documentation/product/features/lytics-javascript-tag/using-version-2/collecting-data
 * https://learn.lytics.com/documentation/product/features/lytics-javascript-tag/using-version-3/collecting-data

 *
 * @class
 * @extends BaseProvider
 */

class LyticsProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "LYTICS";
        this._pattern   = /c\.lytics.io\/c\//;
        this._name      = "Lytics";
        this._type      = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "cid",
            "requestType":  "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "configuration",
                "name": "Configuration"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "loadid" : {
                "name": "loadid",
                "group": "configuration"
            },
            "blockload" : {
                "name": "blockload",
                "group": "configuration"
            },
            "stream" : {
                "name": "stream",
                "group": "configuration"
            },
            "sessecs" : {
                "name": "sessecs",
                "group": "configuration"
            },
            "qsargs" : {
                "name": "qsargs",
                "group": "configuration"
            },
            "_e" : {
                "name": "Event",
                "group": "general"
            },
            "_ref" : {
                "name": "Referral Domain",
                "group": "general"
            },
            "_tz" : {
                "name": "User Time Zone",
                "group": "general"
            },
            "_ul" : {
                "name": "User Language",
                "group": "general"
            },
            "_sz" : {
                "name": "Display Size",
                "group": "general"
            },
            "_ts" : {
                "name": "Timestamp",
                "group": "general"
            },
            "_nmob" : {
                "name": "Not Mobile Device",
                "group": "general"
            },
            "_device" : {
                "name": "Current Device",
                "group": "general"
            },
            "url" : {
                "name": "URL",
                "group": "general"
            },
            "_uid" : {
                "name": "Lytics UID",
                "group": "general"
            },
            "_uido" : {
                "name": "Lytics UID",
                "group": "general"
            },
            "_v" : {
                "name": "Javascript Tag Version",
                "group": "general"
            },
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     
    LEFT IN AS EXAMPLE 
    handleQueryParam(name, value)
    {
        let result = {};

        if(name.indexOf("attrs.") === 0) {
            result = {
                "key":   name,
                "field": name.replace("attrs.", ""),
                "value": value,
                "group": "customattributes"
            };
        }
        else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }*/

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let results = [];

        // Client Code
        const clientCodeRe = /\/c\/(.+)$/;
        let clientCodematches =  url.pathname.match(clientCodeRe);
        if(clientCodematches !== null) {
            results.push({
                "key":   "cid",
                "field": "Account ID",
                "value": clientCodematches[1],
                "group": "general"
            });
        }
        
        
        // Event Type (_e) or (event) value parsed to requesttype
        let eventType = params.get("_e") || params.get("event") || "Other";
        const eventDict = {
            "pv" : "Page View",
            "conversion": "Conversion"
        };
        let eventTypeValue = eventDict[eventType] ? eventDict[eventType] : eventType;
        results.push({
            "key":   "requestTypeParsed",
            "field": "Request Type",
            "value": eventTypeValue,
            "group": "general"
        });


        return results;
    } // handle custom
} // class
/**
 * Matomo (Formerly Piwik)
 * http://matomo.org
 *
 * @class
 * @extends BaseProvider
 */
class MatomoProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "MATOMO";
        this._pattern = /\/(piwik|matomo)\.php\?/;
        this._name = "Matomo";
        this._type = "analytics";
        this._keywords = ["piwik"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "trackingServer",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "dimensions",
                "name": "Dimensions"
            },
            {
                "key": "custom",
                "name": "Custom Variables"
            },
            {
                "key": "ecommerce",
                "name": "E-commerce"
            },
            {
                "key": "events",
                "name": "Events"
            },
            {
                "key": "content",
                "name": "Content"
            },
            {
                "key": "media",
                "name": "Media"
            }
        ];
    }

    /**+
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "idsite": {
                "name": "Website ID",
                "group": "general"
            },
            "rec": {
                "name": "Required for Tracking",
                "group": "other"
            },
            "action_name": {
                "name": "Action Name",
                "group": "general"
            },
            "url": {
                "name": "Page URL",
                "group": "general"
            },
            "_id": {
                "name": "Visitor ID",
                "group": "general"
            },
            "rand": {
                "name": "Cache Buster",
                "group": "other"
            },
            "apiv": {
                "name": "API Version",
                "group": "other"
            },
            "urlref": {
                "name": "Page Referrer",
                "group": "general"
            },
            "_idvc": {
                "name": "Visit Number",
                "group": "general"
            },
            "_viewts": {
                "name": "Previous Visit Timestamp",
                "group": "other"
            },
            "_idts": {
                "name": "First Visit Timestamp",
                "group": "other"
            },
            "_rcn": {
                "name": "Campaign Name",
                "group": "general"
            },
            "_rck": {
                "name": "Campaign Keyword",
                "group": "general"
            },
            "res": {
                "name": "Screen Resolution",
                "group": "other"
            },
            "h": {
                "name": "Browser Time (Hour)",
                "group": "other"
            },
            "m": {
                "name": "Browser Time (Minute)",
                "group": "other"
            },
            "s": {
                "name": "Browser Time (Sectond)",
                "group": "other"
            },
            "fla": {
                "name": "Has Plugin: Flash",
                "group": "other"
            },
            "java": {
                "name": "Has Plugin: Java",
                "group": "other"
            },
            "dir": {
                "name": "Has Plugin: Director",
                "group": "other"
            },
            "qt": {
                "name": "Has Plugin: Quicktime",
                "group": "other"
            },
            "realp": {
                "name": "Has Plugin: Real Player",
                "group": "other"
            },
            "pdf": {
                "name": "Has Plugin: PDF",
                "group": "other"
            },
            "wma": {
                "name": "Has Plugin: Windows Media Player",
                "group": "other"
            },
            "gears": {
                "name": "Has Plugin: Gears",
                "group": "other"
            },
            "ag": {
                "name": "Has Plugin: Silverlight",
                "group": "other"
            },
            "cookie": {
                "name": "Browser Supports Cookies",
                "group": "other"
            },
            "ua": {
                "name": "User Agent",
                "group": "general"
            },
            "lang": {
                "name": "Browser Language",
                "group": "general"
            },
            "uid": {
                "name": "User ID",
                "group": "general"
            },
            "cid": {
                "name": "Visitor ID",
                "group": "general"
            },
            "new_visit": {
                "name": "Force New Visit",
                "group": "general"
            },
            "exit": {
                "name": "Exit Link",
                "group": "general"
            },
            "link": {
                "name": "Exit Link",
                "group": "general"
            },
            "download": {
                "name": "Download Link",
                "group": "general"
            },
            "search": {
                "name": "Site Search Keyword",
                "group": "general"
            },
            "search_cat": {
                "name": "Site Search Category",
                "group": "general"
            },
            "search_count": {
                "name": "Site Search Results Count",
                "group": "general"
            },
            "pv_id": {
                "name": "Page View ID",
                "group": "general"
            },
            "idgoal": {
                "name": "Goal ID",
                "group": "general"
            },
            "revenue": {
                "name": "Revenue",
                "hidden": true
            },
            "gt_ms": {
                "name": "Action Generation Time (ms)",
                "group": "other"
            },
            "e_c": {
                "name": "Event Category",
                "group": "events"
            },
            "e_a": {
                "name": "Event Action",
                "group": "events"
            },
            "e_n": {
                "name": "Event Name",
                "group": "events"
            },
            "e_v": {
                "name": "Event Value",
                "group": "events"
            },
            "c_n": {
                "name": "Content Name",
                "group": "content"
            },
            "c_p": {
                "name": "Content Piece",
                "group": "content"
            },
            "c_t": {
                "name": "Content Target",
                "group": "content"
            },
            "c_i": {
                "name": "Content Interaction",
                "group": "content"
            },
            "ec_id": {
                "name": "Order ID",
                "group": "ecommerce"
            },
            "ec_st": {
                "name": "Sub-total",
                "group": "ecommerce"
            },
            "ec_tx": {
                "name": "Tax",
                "group": "ecommerce"
            },
            "ec_sh": {
                "name": "Shipping",
                "group": "ecommerce"
            },
            "ec_dt": {
                "name": "Discount",
                "group": "ecommerce"
            },
            "_ects": {
                "name": "Previous Order Timestamp",
                "group": "ecommerce"
            },
            "token_auth": {
                "name": "API Token",
                "group": "other"
            },
            "cip": {
                "name": "Visitor IP",
                "group": "other"
            },
            "cdt": {
                "name": "Request Timestamp",
                "group": "other"
            },
            "country": {
                "name": "Country",
                "group": "general"
            },
            "region": {
                "name": "Region",
                "group": "general"
            },
            "city": {
                "name": "City",
                "group": "general"
            },
            "lat": {
                "name": "Latitude",
                "group": "general"
            },
            "long": {
                "name": "Longitude",
                "group": "general"
            },
            "queuedtracking": {
                "name": "Queue Tracking",
                "group": "other",
            },
            "ping": {
                "name": "Ping",
                "group": "other"
            },
            "ma_id": {
                "name": "Media ID",
                "group": "media"
            },
            "ma_ti": {
                "name": "Media Title",
                "group": "media"
            },
            "ma_re": {
                "name": "Media Resource",
                "group": "media"
            },
            "ma_mt": {
                "name": "Media Type",
                "group": "media"
            },
            "ma_pn": {
                "name": "Media Player Name",
                "group": "media"
            },
            "ma_st": {
                "name": "Media Duration (sec)",
                "group": "media"
            },
            "ma_ps": {
                "name": "Current Position",
                "group": "media"
            },
            "ma_ttp": {
                "name": "Time Until Media Played",
                "group": "media"
            },
            "ma_w": {
                "name": "Media Width",
                "group": "media"
            },
            "ma_h": {
                "name": "Media Height",
                "group": "media"
            },
            "ma_fs": {
                "name": "Fullscreen Media",
                "group": "media"
            },
            "ma_se": {
                "name": "Media Positions Played",
                "group": "media"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value) {
        let result = {};
        if (name === "_cvar") {
            result = {
                "key": "_cvar",
                "hidden": true
            };
        } else if (name === "ec_items") {
            result = {
                "key": "ec_items",
                "hidden": true
            };
        } else if (/^dimension(\d+)$/.test(name)) {
            result = {
                "key": name,
                "field": `Dimension ${RegExp.$1}`,
                "value": value,
                "group": "dimensions"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        let results = [],
            revenue = params.get("revenue"),
            _cvar = params.get("_cvar"),
            ec_items = params.get("ec_items"),
            requestType = "Page View";

        // Change the revenue group/name based on if an ecom order was placed
        if (revenue) {
            if (params.get("ec_id")) {
                results.push({
                    "key": "revenue",
                    "field": "Order Revenue",
                    "value": params.get("revenue"),
                    "group": "ecommerce"
                });
            } else if (params.get("ec_items")) {
                results.push({
                    "key": "revenue",
                    "field": "Cart Revenue",
                    "value": params.get("revenue"),
                    "group": "ecommerce"
                });
            } else {
                results.push({
                    "key": "revenue",
                    "field": "Goal Revenue",
                    "value": params.get("revenue"),
                    "group": "general"
                });
            }

        }

        // Custom Variables
        if (_cvar) {
            try {
                let customVars = JSON.parse(_cvar);
                /* istanbul ignore else: do nothing when it's null/empty */
                if (typeof customVars === "object" && customVars) {
                    Object.entries(customVars).forEach(([key, [name, value]]) => {
                        results.push({
                            "key": `_cvar${key}n`,
                            "field": `Custom Variable ${key} Name`,
                            "value": name,
                            "group": "custom"
                        }, {
                            "key": `_cvar${key}v`,
                            "field": `Custom Variable ${key} Value`,
                            "value": value,
                            "group": "custom"
                        });
                    });
                }
            } catch (e) {
                /* istanbul ignore next: push the full value to the key */
                results.push({
                    "key": "_cvar",
                    "field": "Custom Variables",
                    "value": _cvar,
                    "group": "custom"
                });
            }
        }

        // Ecommerce products
        if (ec_items) {
            try {
                let products = JSON.parse(ec_items);
                /* istanbul ignore else: do nothing when it's null/empty */
                if (typeof products === "object" && products.length) {
                    products.forEach(([sku, name, category, price, qty], i) => {
                        let j = i + 1;
                        results.push({
                            "key": `ec_item${j}s`,
                            "field": `Product ${j} SKU`,
                            "value": sku,
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}n`,
                            "field": `Product ${j} Name`,
                            "value": name,
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}c`,
                            "field": `Product ${j} Category`,
                            "value": (typeof category === "object" && category.length) ? category.join(", ") : category,
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}p`,
                            "field": `Product ${j} Price`,
                            "value": price.toString(),
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}q`,
                            "field": `Product ${j} Quantity`,
                            "value": qty.toString(),
                            "group": "ecommerce"
                        });
                    });
                }
            } catch (e) {
                /* istanbul ignore next: push the full value to the key */
                results.push({
                    "key": "ec_items",
                    "field": "Products",
                    "value": ec_items,
                    "group": "ecommerce"
                });
            }
        }

        // Figure out the request type
        if (params.get("search")) {
            requestType = "Site Search";
        } else if (params.get("idgoal") === "0") {
            requestType = "Ecommerce";
        } else if (params.get("idgoal")) {
            requestType = "Goal";
        } else if (params.get("exit") || params.get("link")) {
            requestType = "Exit Click";
        } else if (params.get("download")) {
            requestType = "Download Click";
        } else if (params.get("c_i")) {
            requestType = "Content Interaction";
        } else if (params.get("e_c")) {
            requestType = "Custom Event";
        } else if (params.get("ping")) {
            requestType = "Ping";
        }

        results.push({
            "key": "requestType",
            "value": requestType,
            "hidden": "true"
        });

        // Where the request was sent
        results.push({
            "key": "trackingServer",
            "field": "Tracking Server",
            "value": url.hostname,
            "group": "general"
        });

        return results;
    }
}
/**
 * Medallia Digital Experience Analytics (f/k/a Decibel Insights)
 * https://www.medallia.com/products/digital-experience-analytics/
 * https://developer.medallia.com/medallia-dxa/docs/introduction

 *
 * @class
 * @extends BaseProvider
 */

class MedalliaDXAProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "MEDALLIADXA";
        this._pattern   = /\/i\/\d+\/\d+\/di\.js/;
        this._name      = "Medallia DXA";
        this._type      = "replay";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "_account",
            "requestType":  "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                key: "general",
                name: "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let results = [];

        // Account info
        const accountInfo =  url.pathname.match(/\/i\/(\d+)\/(\d+)\/di\.js/);
        if(accountInfo !== null) {
            results.push({
                "key":   "_account",
                "value": `${accountInfo[1]} / ${accountInfo[2]}`,
                "hidden": true,
            });
            results.push({
                "key":   "_accountID",
                "field": "Account ID",
                "value": accountInfo[1],
                "group": "general"
            });
            results.push({
                "key":   "_propertyID",
                "field": "Property ID",
                "value": accountInfo[2],
                "group": "general"
            });
        }

        results.push({
            "key":   "requestTypeParsed",
            "field": "Request Type",
            "value": "Library Load",
            "group": "general"
        });


        return results;
    } // handle custom
} // class

/**
 * Merkle Merkury
 * https://cheq.ai/ensighten/enterprise-tag-management/
 *
 * @class
 * @extends BaseProvider
 */
class MerkleMerkuryProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "MERKLEMERKURY";
        this._pattern    = /\/tpTracking\/loader\/load\.js/;
        this._name       = "Merkle Merkury";
        this._type       = "visitorid";
        this._keywords   = [];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "sv_cid",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
        ];
    }

    /**
     * Get all the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "sv_cid": {
                "name": "Account ID",
                "group": "general"
            },
            "url": {
                "name": "Page URL",
                "group": "general"
            }
        };
    }
}

/**
 * Microsoft Clarity
 * https://clarity.microsoft.com/
 *
 * @class
 * @extends BaseProvider
 */
class MicrosoftClarityProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "MSCLARITY";
        this._pattern = /clarity\.ms\/tag\//;
        this._name = "Microsoft Clarity";
        this._type = "replay";
        this._keywords = ["heat map", "heatmap", "session record", "click"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account":     "account",
            "requestType": "omnibug_requestType"
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        return [
            {
                "key":   "account",
                "field": "Account ID",
                "value": url.pathname.split("/").pop(),
                "group": "general"
            },
            {
                "key": "omnibug_requestType",
                "value": "Library Load",
                "hidden": "true"
            }
        ];
    }
}

/**
 * Mixpanel
 * https://developer.mixpanel.com/reference/overview
 *
 * @class
 * @extends BaseProvider
 */
class MixpanelProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "MIXPANEL";
        this._pattern = /mixpanel.com\/(?:engage|track)/;
        this._name = "Mixpanel";
        this._type = "analytics";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "token",
            "requestType": "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Get all the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "pm": {
                "name": "Tracking ID",
                "group": "general"
            }
        };
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "") {
        // In some cases the post data comes in as a URI encoded string (similar to form data)
        if(typeof postData === "string" && postData.indexOf("data=%5B") === 0) {
            // Likely not the best solution, but solved until next version of Omnibug that better handles these scenarios
            postData = decodeURIComponent(postData.slice(5));
        }

        const original = super.parsePostData(postData),
            dataField = original.find(([key, value]) => key === "data");
        if(dataField) {
            return super.parsePostData(dataField[1]);
        }

        return original;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            requestType = [],
            foundToken = false;

        params.forEach((value, key) => {
            if(/(?:^|\.)event$/.test(key)) {
                value = value.replace("$mp_web_page_view", "Page View");
                requestType.push(value);
            }
            if(!foundToken && /properties\.token$/.test(key)) {
                results.push({
                    "key": "token",
                    "value": value,
                    "hidden": true
                });
                foundToken = true;
            }
        });

        if(requestType.length) {
            requestType = ((requestType.length > 1) ? `(${requestType.length}) ` : ``) + `${requestType.join(", ")}`;
        } else {
            requestType = "Other";
        }

        results.push({
            "key": "requestTypeParsed",
            "value": requestType,
            "hidden": true
        });

        return results;
    }
}

/**
 * Mparticle
 * https://docs.mparticle.com/developers/sdk/javascript/getting-started
 *
 * @class
 * @extends BaseProvider
 */

class MparticleProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "MPARTICLE";
        this._pattern   = /\.mparticle\.com\/v\d\/JS\/[^/]+\/[eE]vents/;
        this._name      = "Mparticle";
        this._type      = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "clientCode",
            "requestType":  "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "customattributes",
                "name": "Custom Attributes"
            },
            {
                "key": "userattributes",
                "name": "User Attributes"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "av" : {
                "name": "Application Version",
                "group": "general"
            },
            "at" : {
                "name": "Application State",
                "group": "general"
            },
            "attrs" : {
                "name": "Attributes",
                "group": "general"
            },
            "cgid" : {
                "name": "Client Generated ID",
                "group": "general"
            },
            "ct" : {
                "name": "Unix Time",
                "group": "general"
            },
            "das" : {
                "name": "Device Application Stamp",
                "group": "general"
            },
            "dbg" : {
                "name": "Debug",
                "group": "general"
            },
            "dt" : {
                "name": "Data Type",
                "group": "general"
            },
            "eec" : {
                "name": "Expanded Event Count",
                "group": "general"
            },
            "et" : {
                "name": "Event Type",
                "group": "general"
            },
            "flags" : {
                "name": "flags",
                "group": "general"
            },
            "fr" : {
                "name": "First Run",
                "group": "general"
            },
            "iu" : {
                "name": "Is Upgrade",
                "group": "general"
            },
            "lc" : {
                "name": "Location",
                "group": "general"
            },
            "lr" : {
                "name": "Launch Referral",
                "group": "general"
            },
            "mpid" : {
                "name": "Mparticle ID",
                "group": "general"
            },
            "n" : {
                "name": "Event Name",
                "group": "general"
            },
            "o" : {
                "name": "Opt-Out",
                "group": "general"
            },
            "pb" : {
                "name": "User Product-Bags",
                "group": "general"
            },
            "sdk" : {
                "name" : "SDK Version",
                "group": "general"
            },
            "sid" : {
                "name": "Session UID",
                "group": "general"
            },
            "str" : {
                "name": "Event Store",
                "group": "general"
            },
            "str.uid.Expires" : {
                "name": "uid expires",
                "group": "general"
            },
            "str.uid.Value" : {
                "name": "uid",
                "group": "general"
            },
            "ua" : {
                "name": "User Attributes",
                "group": "general"
            },
            "ui" : {
                "name": "User Identities",
                "group": "general"
            },
            "uic" : {
                "name": "User Identity Change",
                "group": "general"
            },
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        let result = {};
        if(name.indexOf("attrs.") === 0) {
            result = {
                "key":   name,
                "field": name.replace("attrs.", ""),
                "value": value,
                "group": "customattributes"
            };
        } else if (name.indexOf("ua.") === 0) {
            result = {
                "key":   name,
                "field": name.slice(3,name.length),
                "value": value,
                "group": "userattributes"
            };   
        } else if (name.indexOf("ui[") === 0) {
            // hide  
            result = {
                "key": name,
                "value": value,
                "hidden": true
            };
        }
        else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let results = [];

        // Client Code
        const clientCodeRe = /v\d\/JS\/([^/]+)\/events/i;
        let clientCodematches =  url.pathname.match(clientCodeRe);
        if(clientCodematches !== null) {
            results.push({
                "key":   "clientCode",
                "field": "Client Code",
                "value": clientCodematches[1],
                "group": "general"
            });
        }

        // Event Type Value parsed (et)
        let etType = params.get("et");
        if (etType) {
            const etDict = {
                "0": "Unknown",
                "1": "Navigation",
                "2": "Location",
                "3": "Search",
                "4": "Transaction",
                "5": "UserContent",
                "6": "UserPreference",
                "7": "Social",
                "8": "Other",
                "9": "Media",
                "10": "ProductAddToCart",
                "11": "ProductRemoveFromCart",
                "12": "ProductCheckout",
                "13": "ProductCheckoutOption",
                "14": "ProductClick",
                "15": "ProductViewDetail",
                "16": "ProductPurchase",
                "17": "ProductRefund",
                "18": "PromotionView",
                "19": "PromotionClick",
                "20": "ProductAddToWishlist",
                "21": "ProductRemoveFromWishlist",
                "22": "ProductImpression",
                "23": "Attribution",
            };
            let etValue = etDict[etType] ? etDict[etType] : etType;
            results.push({
                "key":   "etParsed",
                "field": "Event Type Value",
                "value": etValue,
                "group": "general"
            });    
        }
        
        // Data type value parsed
        let dataType = params.get("dt");
        if (dataType) {
            const dataTypeDict = {
                "1": "Session Start",
                "2": "Session End",
                "3": "Screen View",
                "4": "Custom Event",
                "5": "Crash Report",
                "6": "Opt Out",
                "10": "App State Transition",
                "14": "Profile Change Message",
                "16": "Commerce Event",
            };
            let dataTypeValue = dataTypeDict[dataType] ? dataTypeDict[dataType] : dataType;
            results.push({
                "key":   "dtvalue",
                "field": "Data Type Value",
                "value": dataTypeValue,
                "group": "general"
            });    
        }
        
        // Event Name (n) value parsed to requesttype

        // v1 & v2 use 'n' parameter to store events
        // v3 uses the events.event_type key
        let eventType = params.get("n") || params.get("events[0].event_type");
        const eventDict = {
            "pageView" : "Page View",
            "1" : "Session Start",
            "2" : "Session End",
            "10": "State Transition"
        };
        let eventTypeValue = eventDict[eventType] ? eventDict[eventType] : eventType;
        results.push({
            "key":   "requestTypeParsed",
            "field": "Request Type",
            "value": eventTypeValue,
            "group": "general"
        });

        // uid
        const identityTypeDict = {
            "0": "other",
            "1": "customerid",
            "2": "facebook",
            "3": "twitter",
            "4": "google",
            "5": "microsoft",
            "6": "yahoo",
            "7": "email",
            "8": "facebookcustomaudienceid",
            "9": "other2",
            "10": "other3",
            "11": "other4"
        };

        let uiArray = [];
        for (let p of params.entries()) {
            let k = p[0],
                v = p[1];
            if (k.indexOf("ui[") === 0) {
                uiArray.push(k);
                uiArray.push(v);
            }
        }
        
        let output = [];
        uiArray.map( (e, idx) => {
            if (idx === 0 || idx % 4 === 0) {
                output.push([e, uiArray[idx+1], uiArray[idx+2], uiArray[idx+3]]);
            }
        });

        output.forEach(e => {
            let idValue = e.toString().split(",")[1];
            let typeValue = e.toString().split(",")[3];
            results.push({
                "key":   identityTypeDict[typeValue] ? identityTypeDict[typeValue] : typeValue,
                "field": `Identity: ${identityTypeDict[typeValue]} (${typeValue})`,
                "value": idValue,
                "group": "userattributes"
            });
        });

        return results;
    }
} // class
/**
 * Omniconvert
 * https://help.omniconvert.com/kba/installing-the-omniconvert-tracking-code-on-your-website/
 *
 * @class
 * @extends BaseProvider
 */
class OmniconvertProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "OMNICONVERT";
        this._pattern    = /\/mktzsave\/?\?/;
        this._name       = "Omniconvert";
        this._type       = "testing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "id_website",
            "requestType": "event"
        };
    }
}

/**
 * Optimizely
 * https://www.optimizely.com/
 *
 * @class
 * @extends BaseProvider
 */
class OptimizelyXProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "OPTIMIZELYX";
        this._pattern    = /\.optimizely\.com\/log\/event/;
        this._name       = "Optimizely X";
        this._type       = "testing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "mbox"
        };
    }


    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {

        };
    }
}
/**
 * Outbrain

 *
 * @class
 * @extends BaseProvider
 */

class OutbrainProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "OUTBRAIN";
        this._pattern   = /tr\.outbrain\.com\//;
        this._name      = "Outbrain";
        this._type      = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "marketerId",
            "requestType":  "requestTypeParsed"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "event",
                "name": "Event Data"
            },
            {
                "key": "configuration",
                "name": "Configuration"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "name" : {
                "name": "Event Name",
                "group": "general"
            },
            "dl" : {
                "name": "Page URL",
                "group": "general"
            },
            "optOut" : {
                "name": "Opt Out",
                "group": "general"
            },
            "bust" : {
                "name": "Cache Buster",
                "group": "other"
            },
            "orderId" : {
                "name": "Order ID",
                "group": "event"
            },
            "orderValue" : {
                "name": "Order Value",
                "group": "event"
            },
            "currency" : {
                "name": "Currency",
                "group": "event"
            },
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let eventType = params.get("name") || "Other";
        return [{
            "key":   "requestTypeParsed",
            "value": eventType === "PAGE_VIEW" ? "Page View" : eventType,
            "hidden": true
        }];
    }
}

/**
 * Parse.ly
 * https://docs.parse.ly/tracking-code-setup/
 *
 * @class
 * @extends BaseProvider
 */
class ParselyProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "PARSELY";
        this._pattern    = /https?:\/\/((p1(-irl)?|srv\.pixel)\.parsely\.com|fpa-events\..*)\/p(logger|x)\/\?rand=/;
        this._name       = "Parse.ly";
        this._type       = "analytics";
        this._keywords   = ["parsely", "parse.ly"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "idsite",
            "requestType": "omnibug_requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "conversions",
                "name": "Conversion Data"
            },
            {
                "key": "segments",
                "name": "Segment Data"
            },
            {
                "key": "metadata",
                "name": "Metadata"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "idsite": {
                "name": "Site ID",
                "group": "general"
            },
            "url": {
                "name": "Page URL",
                "group": "general"
            },
            "urlref": {
                "name": "Referring URL",
                "group": "general"
            },
            "action": {
                "name": "Event Type",
                "group": "general"
            },
            "inc": {
                "name": "Engaged Time Increment",
                "group": "general"
            },
            "u": {
                "name": "Visitor ID",
                "group": "general"
            },
            "data": {
                "name": "Extra Data",
                "group": "general"
            },
            "metadata": {
                "name": "Metadata",
                "group": "metadata"
            },
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {object}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            hitType = params.get("action"),
            requestType = "";

        hitType = hitType.toLowerCase();
        if(hitType === "pageview") {
            requestType = "Page View";
        } else if(hitType === "heartbeat") {
            requestType = "Heartbeat";
        } else if(hitType === "conversion") {
            requestType = "Conversion";
        } else if(hitType === "videostart") {
            requestType = "Video Start";
        } else if(hitType === "vheartbeat") {
            requestType = "Video Heartbeat";
        } else {
            requestType = hitType.charAt(0).toUpperCase() + hitType.slice(1);
        }
        results.push({
            "key":    "omnibug_requestType",
            "value":  requestType,
            "hidden": true
        });

        return results;
    }
}

/**
 * Pinterest Conversions
 * https://developers.pinterest.com/docs/ad-tools/conversion-tag/?
 *
 * @class
 * @extends BaseProvider
 */
class PinterestProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "PINTERESTPIXEL";
        this._pattern = /ct\.pinterest\.com\/v3\/?/;
        this._name = "Pinterest Conversion";
        this._type = "marketing";
        this._keywords = ["conversion", "pintrk", "pinimg"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "tid",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "event",
                "name": "Event Data"
            },
            {
                "key": "ecommerce",
                "name": "E-Commerce"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "tid": {
                "name": "Tag ID",
                "group": "general"
            },
            "event": {
                "name": "Event",
                "group": "general"
            },
            "cb": {
                "name": "Cache Buster",
                "group": "other"
            },
            "noscript": {
                "name": "Image Tag",
                "group": "other"
            },
            "pd[em]": {
                "name": "Hashed Email Address",
                "group": "general"
            },
            "ed[value]": {
                "name": "Revenue",
                "group": "ecommerce"
            },
            "ed[order_quantity]": {
                "name": "Quantity",
                "group": "ecommerce"
            },
            "ed[currency]": {
                "name": "Currency",
                "group": "ecommerce"
            },
            "ed[order_id]": {
                "name": "Order ID",
                "group": "ecommerce"
            },
            "ed[promo_code]": {
                "name": "Promo Code",
                "group": "ecommerce"
            },
            "ed[property]": {
                "name": "Property",
                "group": "ecommerce"
            },
            "ed[search_query]": {
                "name": "Search Query",
                "group": "event"
            },
            "ed[video_title]": {
                "name": "Video Title",
                "group": "event"
            },
            "ed[lead_type]": {
                "name": "Lead Type",
                "group": "event"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value) {
        let result = {};
        if (name === "ed") {
            // do handling in custom
        } else if (name === "pd") {
            // do handling in custom
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            event = params.get("event") || /* istanbul ignore next: fallback */ "Other",
            pageData = params.get("pd"),
            eventData = params.get("ed"),
            requestType = "Conversion";

        // Request Type
        if (event === "pagevisit") {
            requestType = "Page View";
        } else {
            requestType = event.charAt(0).toUpperCase() + event.slice(1).split(/(?=[A-Z])/).join(" ");
        }        
        results.push({
            "key": "requestType",
            "value": requestType,
            "hidden": true
        });

        // Any page-data
        if (pageData) {
            try { 
                let data = JSON.parse(pageData);
                if (typeof data === "object" && data !== null) {
                    Object.entries(data).forEach(([key, data]) => {
                        let result = super.handleQueryParam(`pd[${key}]`, data);
                        if (result) {
                            results.push(result);
                        }
                    });
                }
            } catch (e) {
                results.push({
                    "key": `pd`,
                    "field": "Page Data",
                    "value": pageData,
                    "group": "general"
                });
            }
        }

        // Any event-data
        if (eventData) {
            try {
                let data = JSON.parse(eventData);
                if (typeof data === "object" && data !== null) {
                    Object.entries(data).forEach(([key, data]) => {
                        if (key === "line_items") {
                            // Line items requires additional parsing
                            if (Array.isArray(data)) {
                                data.forEach((product, i) => {
                                    if (typeof product === "object" && product !== null) {
                                        Object.entries(product).forEach(([productKey, productValue]) => {

                                            // Title case the field name
                                            let field = productKey.replace("product_", "").replace(/_/g, " ").replace(
                                                /\w\S*/g,
                                                (txt) => {
                                                    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
                                                }
                                            ).replace("Id", "ID");

                                            results.push({
                                                "key": `ed[line_items][${i}][${productKey}]`,
                                                "field": `Product ${i + 1} ${field}`,
                                                "value": productValue,
                                                "group": "ecommerce"
                                            });
                                        });
                                    }
                                });
                            }
                        } else {
                            // Everything is (currently) one level
                            let result = super.handleQueryParam(`ed[${key}]`, data);
                            if (result) {
                                results.push(result);
                            }
                        }
                    });
                }
            } catch (e) {
                results.push({
                    "key": `ed`,
                    "field": "Ecommerce Data",
                    "value": eventData,
                    "group": "ecommerce"
                });
            }
        }

        return results;
    }
}
/**
 * Piwik PRO
 * https://piwik.pro
 *
 * @class
 * @extends BaseProvider
 */
class PiwikPROProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "PIWIKPRO";
        this._pattern = /\/ppms\.php/;
        this._name = "Piwik PRO";
        this._type = "analytics";
        this._keywords = ["piwikpro", "matomo"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "trackingServer",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "dimensions",
                "name": "Dimensions"
            },
            {
                "key": "custom",
                "name": "Custom Variables"
            },
            {
                "key": "ecommerce",
                "name": "E-commerce"
            },
            {
                "key": "events",
                "name": "Events"
            },
            {
                "key": "content",
                "name": "Content"
            },
            {
                "key": "media",
                "name": "Media"
            },
            {
                "key": "rum",
                "name": "Real User Monitoring"
            }
        ];
    }

    /**+
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "idsite": {
                "name": "Website ID",
                "group": "general"
            },
            "rec": {
                "name": "Required for Tracking",
                "group": "other"
            },
            "action_name": {
                "name": "Action Name",
                "group": "general"
            },
            "url": {
                "name": "Page URL",
                "group": "general"
            },
            "_id": {
                "name": "Visitor ID",
                "group": "general"
            },
            "r": {
                "name": "Cache Buster",
                "group": "other"
            },
            "apiv": {
                "name": "API Version",
                "group": "other"
            },
            "urlref": {
                "name": "Page Referrer",
                "group": "general"
            },
            "_idvc": {
                "name": "Visit Number",
                "group": "general"
            },
            "_viewts": {
                "name": "Previous Visit Timestamp",
                "group": "other"
            },
            "_idts": {
                "name": "First Visit Timestamp",
                "group": "other"
            },
            "_idn": {
                "name": "New Visitor",
                "group": "generalx"
            },
            "_rcn": {
                "name": "Campaign Name",
                "group": "general"
            },
            "_rck": {
                "name": "Campaign Keyword",
                "group": "general"
            },
            "res": {
                "name": "Screen Resolution",
                "group": "other"
            },
            "h": {
                "name": "Browser Time (Hour)",
                "group": "other"
            },
            "m": {
                "name": "Browser Time (Minute)",
                "group": "other"
            },
            "s": {
                "name": "Browser Time (Sectond)",
                "group": "other"
            },
            "fla": {
                "name": "Has Plugin: Flash",
                "group": "other"
            },
            "java": {
                "name": "Has Plugin: Java",
                "group": "other"
            },
            "dir": {
                "name": "Has Plugin: Director",
                "group": "other"
            },
            "qt": {
                "name": "Has Plugin: Quicktime",
                "group": "other"
            },
            "realp": {
                "name": "Has Plugin: Real Player",
                "group": "other"
            },
            "pdf": {
                "name": "Has Plugin: PDF",
                "group": "other"
            },
            "wma": {
                "name": "Has Plugin: Windows Media Player",
                "group": "other"
            },
            "gears": {
                "name": "Has Plugin: Gears",
                "group": "other"
            },
            "ag": {
                "name": "Has Plugin: Silverlight",
                "group": "other"
            },
            "cookie": {
                "name": "Browser Supports Cookies",
                "group": "other"
            },
            "ua": {
                "name": "User Agent",
                "group": "general"
            },
            "lang": {
                "name": "Browser Language",
                "group": "general"
            },
            "uid": {
                "name": "User ID",
                "group": "general"
            },
            "cid": {
                "name": "Visitor ID",
                "group": "general"
            },
            "new_visit": {
                "name": "Force New Visit",
                "group": "general"
            },
            "exit": {
                "name": "Exit Link",
                "group": "general"
            },
            "link": {
                "name": "Exit Link",
                "group": "general"
            },
            "download": {
                "name": "Download Link",
                "group": "general"
            },
            "search": {
                "name": "Site Search Keyword",
                "group": "general"
            },
            "search_cat": {
                "name": "Site Search Category",
                "group": "general"
            },
            "search_count": {
                "name": "Site Search Results Count",
                "group": "general"
            },
            "pv_id": {
                "name": "Page View ID",
                "group": "general"
            },
            "idgoal": {
                "name": "Goal ID",
                "group": "general"
            },
            "revenue": {
                "name": "Revenue",
                "hidden": true
            },
            "gt_ms": {
                "name": "Action Generation Time (ms)",
                "group": "other"
            },
            "e_c": {
                "name": "Event Category",
                "group": "events"
            },
            "e_a": {
                "name": "Event Action",
                "group": "events"
            },
            "e_n": {
                "name": "Event Name",
                "group": "events"
            },
            "e_v": {
                "name": "Event Value",
                "group": "events"
            },
            "c_n": {
                "name": "Content Name",
                "group": "content"
            },
            "c_p": {
                "name": "Content Piece",
                "group": "content"
            },
            "c_t": {
                "name": "Content Target",
                "group": "content"
            },
            "c_i": {
                "name": "Content Interaction",
                "group": "content"
            },
            "ec_id": {
                "name": "Order ID",
                "group": "ecommerce"
            },
            "ec_st": {
                "name": "Sub-total",
                "group": "ecommerce"
            },
            "ec_tx": {
                "name": "Tax",
                "group": "ecommerce"
            },
            "ec_sh": {
                "name": "Shipping",
                "group": "ecommerce"
            },
            "ec_dt": {
                "name": "Discount",
                "group": "ecommerce"
            },
            "_ects": {
                "name": "Previous Order Timestamp",
                "group": "ecommerce"
            },
            "token_auth": {
                "name": "API Token",
                "group": "other"
            },
            "cip": {
                "name": "Visitor IP",
                "group": "other"
            },
            "cdt": {
                "name": "Request Timestamp",
                "group": "other"
            },
            "country": {
                "name": "Country",
                "group": "general"
            },
            "region": {
                "name": "Region",
                "group": "general"
            },
            "city": {
                "name": "City",
                "group": "general"
            },
            "lat": {
                "name": "Latitude",
                "group": "general"
            },
            "long": {
                "name": "Longitude",
                "group": "general"
            },
            "queuedtracking": {
                "name": "Queue Tracking",
                "group": "other",
            },
            "ping": {
                "name": "Ping",
                "group": "other"
            },
            "ma_id": {
                "name": "Media ID",
                "group": "media"
            },
            "ma_ti": {
                "name": "Media Title",
                "group": "media"
            },
            "ma_re": {
                "name": "Media Resource",
                "group": "media"
            },
            "ma_mt": {
                "name": "Media Type",
                "group": "media"
            },
            "ma_pn": {
                "name": "Media Player Name",
                "group": "media"
            },
            "ma_st": {
                "name": "Media Duration (sec)",
                "group": "media"
            },
            "ma_ps": {
                "name": "Current Position",
                "group": "media"
            },
            "ma_ttp": {
                "name": "Time Until Media Played",
                "group": "media"
            },
            "ma_w": {
                "name": "Media Width",
                "group": "media"
            },
            "ma_h": {
                "name": "Media Height",
                "group": "media"
            },
            "ma_fs": {
                "name": "Fullscreen Media",
                "group": "media"
            },
            "ma_se": {
                "name": "Media Positions Played",
                "group": "media"
            },
            "t_us": {
                "name": "Unload Event Start",
                "group": "rum"
            },
            "t_ue": {
                "name": "Unload Event End",
                "group": "rum"
            },
            "t_rs": {
                "name": "Redirect Start",
                "group": "rum"
            },
            "t_re": {
                "name": "Redirect End",
                "group": "rum"
            },
            "t_fs": {
                "name": "Fetch Start",
                "group": "rum"
            },
            "t_ss": {
                "name": "Secure Connection Start",
                "group": "rum"
            },
            "t_ds": {
                "name": "Domain Lookup Start",
                "group": "rum"
            },
            "t_cs": {
                "name": "Connect Start",
                "group": "rum"
            },
            "t_ce": {
                "name": "Connect End",
                "group": "rum"
            },
            "t_qs": {
                "name": "Request Start Start",
                "group": "rum"
            },
            "t_as": {
                "name": "Response Start",
                "group": "rum"
            },
            "t_ae": {
                "name": "Response End",
                "group": "rum"
            },
            "t_dl": {
                "name": "DOM Loading",
                "group": "rum"
            },
            "t_di": {
                "name": "DOM Interactive",
                "group": "rum"
            },
            "t_ls": {
                "name": "DOM Content Loaded Event Start",
                "group": "rum"
            },
            "t_le": {
                "name": "DOM Content Loaded Event End",
                "group": "rum"
            },
            "t_dc": {
                "name": "DOM Complete",
                "group": "rum"
            },
            "t_ee": {
                "name": "Load Event End",
                "group": "rum"
            }
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value) {
        let result = {};
        if (name === "_cvar") {
            result = {
                "key": "_cvar",
                "hidden": true
            };
        } else if (name === "cvar") {
            result = {
                "key": "cvar",
                "hidden": true
            };
        } else if (name === "ec_items") {
            result = {
                "key": "ec_items",
                "hidden": true
            };
        } else if (/^dimension(\d+)$/.test(name)) {
            result = {
                "key": name,
                "field": `Dimension ${RegExp.$1}`,
                "value": value,
                "group": "dimensions"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        let results = [],
            revenue = params.get("revenue"),
            _cvar = params.get("_cvar"),
            cvar = params.get("cvar"),
            ec_items = params.get("ec_items"),
            requestType = "Page View";

        // Change the revenue group/name based on if an ecom order was placed
        if (revenue) {
            if (params.get("ec_id")) {
                results.push({
                    "key": "revenue",
                    "field": "Order Revenue",
                    "value": params.get("revenue"),
                    "group": "ecommerce"
                });
            } else if (params.get("ec_items")) {
                results.push({
                    "key": "revenue",
                    "field": "Cart Revenue",
                    "value": params.get("revenue"),
                    "group": "ecommerce"
                });
            } else {
                results.push({
                    "key": "revenue",
                    "field": "Goal Revenue",
                    "value": params.get("revenue"),
                    "group": "general"
                });
            }

        }

        // Custom Variables
        if (_cvar) {
            try {
                let customVars = JSON.parse(_cvar);
                /* istanbul ignore else: do nothing when it's null/empty */
                if (typeof customVars === "object" && customVars) {
                    Object.entries(customVars).forEach(([key, [name, value]]) => {
                        results.push({
                            "key": `_cvar${key}n`,
                            "field": `Custom Visit Variable ${key} Name`,
                            "value": name,
                            "group": "custom"
                        }, {
                            "key": `_cvar${key}v`,
                            "field": `Custom Visit Variable ${key} Value`,
                            "value": value,
                            "group": "custom"
                        });
                    });
                }
            } catch (e) {
                /* istanbul ignore next: push the full value to the key */
                results.push({
                    "key": "_cvar",
                    "field": "Custom Visit Variables",
                    "value": _cvar,
                    "group": "custom"
                });
            }
        }

        if (cvar) {
            try {
                let customVars = JSON.parse(cvar);
                /* istanbul ignore else: do nothing when it's null/empty */
                if (typeof customVars === "object" && customVars) {
                    Object.entries(customVars).forEach(([key, [name, value]]) => {
                        results.push({
                            "key": `cvar${key}n`,
                            "field": `Custom Action Variable ${key} Name`,
                            "value": name,
                            "group": "custom"
                        }, {
                            "key": `cvar${key}v`,
                            "field": `Custom Action Variable ${key} Value`,
                            "value": value,
                            "group": "custom"
                        });
                    });
                }
            } catch (e) {
                /* istanbul ignore next: push the full value to the key */
                results.push({
                    "key": "cvar",
                    "field": "Custom Action Variables",
                    "value": cvar,
                    "group": "custom"
                });
            }
        }

        // Ecommerce products
        if (ec_items) {
            try {
                let products = JSON.parse(ec_items);
                /* istanbul ignore else: do nothing when it's null/empty */
                if (typeof products === "object" && products.length) {
                    products.forEach(([sku, name, category, price, qty], i) => {
                        let j = i + 1;
                        results.push({
                            "key": `ec_item${j}s`,
                            "field": `Product ${j} SKU`,
                            "value": sku,
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}n`,
                            "field": `Product ${j} Name`,
                            "value": name,
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}c`,
                            "field": `Product ${j} Category`,
                            "value": (typeof category === "object" && category.length) ? category.join(", ") : category,
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}p`,
                            "field": `Product ${j} Price`,
                            "value": price.toString(),
                            "group": "ecommerce"
                        }, {
                            "key": `ec_item${j}q`,
                            "field": `Product ${j} Quantity`,
                            "value": qty.toString(),
                            "group": "ecommerce"
                        });
                    });
                }
            } catch (e) {
                /* istanbul ignore next: push the full value to the key */
                results.push({
                    "key": "ec_items",
                    "field": "Products",
                    "value": ec_items,
                    "group": "ecommerce"
                });
            }
        }

        // Figure out the request type
        if (params.get("search")) {
            requestType = "Site Search";
        } else if (params.get("idgoal") === "0") {
            requestType = "Ecommerce";
        } else if (params.get("idgoal")) {
            requestType = "Goal";
        } else if (params.get("exit") || params.get("link")) {
            requestType = "Exit Click";
        } else if (params.get("download")) {
            requestType = "Download Click";
        } else if (params.get("c_i")) {
            requestType = "Content Interaction";
        } else if (params.get("e_c")) {
            requestType = "Custom Event";
        } else if (params.get("ping")) {
            requestType = "Ping";
        }

        results.push({
            "key": "requestType",
            "value": requestType,
            "hidden": "true"
        });

        // Where the request was sent
        results.push({
            "key": "trackingServer",
            "field": "Tracking Server",
            "value": url.hostname,
            "group": "general"
        });

        return results;
    }
}

/**
 * Piwik PRO
 * https://piwik.pro/tag-manager/
 *
 * @class
 * @extends BaseProvider
 */
class PiwikPROTagManagerProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "PIWIKPROTMS";
        this._pattern = /\.piwik\.pro\/containers\/[a-z0-9-]+\.js/;
        this._name = "Piwik PRO Tag Manager";
        this._type = "tagmanager";
        this._keywords = ["piwik", "matomo", "tms"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "container_id",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params) {
        let matches = url.pathname.match(/^\/containers\/([a-z0-9-]+)\.js/),
            id = (matches && matches[1]) ? matches[1] : /* istanbul ignore next: should never happen, but it's a simple string default */ "";

        return [
            {
                "key": "requestType",
                "value": "Library Load",
                "hidden": true
            }, {
                "key": "container_id",
                "field": "Container ID",
                "value": id,
                "group": "general"
            }
        ];
    }
}

/**
 * Reddit Pixel
 * https://reddit.my.site.com/helpcenter/s/article/Install-the-Reddit-Pixel-on-your-website
 *
 * @class
 * @extends BaseProvider
 */
class RedditPixelProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "REDDITPIXEL";
        this._pattern = /reddit\.com\/rp\.gif/;
        this._name = "Reddit Pixel";
        this._type = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "id",
            "requestType": "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "event",
                "name": "Event Data"
            }
        ];
    }

    /**
     * Get all the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "id": {
                "name": "Account ID",
                "group": "general"
            },
            "event": {
                "name": "Event Name",
                "group": "event"
            },
            "m.customEventName": {
                "name": "Custom Event Name",
                "group": "event"
            },
            "m.itemCount": {
                "name": "Item Count",
                "group": "event"
            },
            "m.value": {
                "name": "Value",
                "group": "event"
            },
            "m.valueDecimal": {
                "name": "Value (Decimal)",
                "group": "event"
            },
            "m.currency": {
                "name": "Currency",
                "group": "event"
            },
            "m.products": {
                "name": "Products",
                "group": "event"
            },
            "m.conversionId": {
                "name": "Conversion ID",
                "group": "event"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        const results = [];

        results.push({
            "key": "_requestType",
            "value": params.get("m.customEventName") || params.get("event"),
            "hidden": true,
        });

        return results;
    }
}

/**
 * RTB House
 * https://www.rtbhouse.com/our-products/personalized-retargeting/
 *
 * @class
 * @extends BaseProvider
 */

class RTBHouseProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "RTBHOUSE";
        this._pattern   = /creativecdn\.com\/tags\/?\?/;
        this._name      = "RTB House";
        this._type      = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "id"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "id" : {
                "name": "Pixel ID",
                "group": "general"
            },
        };
    }
}

/**
 * RudderStack
 * https://www.rudderstack.com/
 *
 * @class
 * @extends BaseProvider
 */
class RudderStackProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "RUDDERSTACK";
        this._pattern    = /rudderstack\.com\/v1\//;
        this._name       = "RudderStack";
        this._type       = "analytics";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "requestType":  "omnibug_requestType"
        };
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {

        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            action = url.pathname.match(/\/v1\/([^/]+)$/);
        if(action) {
            let type = action[1].toLowerCase();
            if(type === "p" || type === "page") {
                type = "Page";
            } else if(type === "i" || type === "identify") {
                type = "Identify";
            } else if(type === "t" || type === "track") {
                type = "Track";
            } else if(type === "s" || type === "screen") {
                type = "Screen";
            } else if(type === "g" || type === "group") {
                type = "Group";
            } else if(type === "a" || type === "alias") {
                type = "Alias";
            } else if(type === "b" || type === "batch") {
                type = "Batch";
            }

            results.push({
                "key":   "omnibug_requestType",
                "value": type,
                "hidden": true
            });
        }
        return results;
    }
}

/**
 * Segment
 * https://segment.com/
 *
 * @class
 * @extends BaseProvider
 */
class SegmentProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "SEGMENT";
        this._pattern    = /(\.segmentapis\.com\/)|(api\.segment\.io\/)/;
        this._name       = "Segment";
        this._type       = "analytics";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "requestType":  "omnibug_requestType"
        };
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {

        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            action = url.pathname.match(/\/v1\/([^/]+)$/);
        if(action) {
            let type = action[1].toLowerCase();
            if(type === "p" || type === "page") {
                type = "Page";
            } else if(type === "i" || type === "identify") {
                type = "Identify";
            } else if(type === "t" || type === "track") {
                type = "Track";
            } else if(type === "s" || type === "screen") {
                type = "Screen";
            } else if(type === "g" || type === "group") {
                type = "Group";
            } else if(type === "a" || type === "alias") {
                type = "Alias";
            } else if(type === "b" || type === "batch") {
                type = "Batch";
            }

            results.push({
                "key":   "omnibug_requestType",
                "value": type,
                "hidden": true
            });
        }
        return results;
    }
}

/**
 * Seznam Sklik
 * https://napoveda.sklik.cz/merici-skripty/
 * https://napoveda.sklik.cz/en/tracking-scripts/
 *
 * @class
 * @extends BaseProvider
 */
class SeznamSklikProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "SEZNAMSKLIK";
        this._pattern    = /c\.seznam\.cz\/(retargeting|conv)\?.+/;
        this._name       = "Seznam Sklik";
        this._type       = "marketing";
        this._keywords   = ["retargeting", "seznam", "seznam.cz", "rc.js", "sklik"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "id",
            "requestType":  "_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "identities",
                "name": "Identities"
            },
            {
                "key": "zbozi.cz",
                "name": "Zbozi.cz"
            }            
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "id": {
                "group": "general"
            },
            "url": {
                "group": "general"
            },
            "consent": {
                "group": "general"
            },
            "value": {
                "group": "general"
            },
            "category": {
                "group": "general"
            },
            "itemId": {
                "group": "general"
            },
            "pageType": {
                "group": "general"
            },
            "ids": {
                "group": "identities"
            },
            "ids.eid": {
                "group": "identities"
            },            
            "orderId": {
                "group": "zbozi.cz"
            },
            "zboziType": {
                "group": "zbozi.cz"
            },
            "zboziId": {
                "group": "zbozi.cz"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matchesRetargeting = /c\.seznam\.cz\/retargeting.+/.test(url),
            matchesConversion = /c\.seznam\.cz\/conv.+/.test(url),
            results = [];

        results.push({
            "key": "_requestType",
            "value": matchesRetargeting ? "Retargeting" : "Conversion",
            "hidden": true,
        });
        return results;
    }
}
/**
 * 6Sense
 * https://6sense.com/platform/
 *
 * @class
 * @extends BaseProvider
 */
class SixSenseProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "SIXSENSE";
        this._pattern    = /6sense\.com\/v3\/company\/details/;
        this._name       = "6Sense";
        this._type       = "visitorid";
        this._keywords   = ["ip lookup"];
    }
}

/**
 * Snap Pixel (Snapchat)
 * https://businesshelp.snapchat.com/en-US/article/snap-pixel-about
 *
 * @class
 * @extends BaseProvider
 */
class SnapchatProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "SNAPCHATPIXEL";
        this._pattern = /tr\.snapchat\.com\/p/;
        this._name = "Snapchat";
        this._type = "marketing";
        this._keywords = ["snap pixel", "snaptr"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "pid",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "ecommerce",
                "name": "E-Commerce"
            },
            {
                "key": "events",
                "name": "Events"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "pid": {
                "name": "Pixel ID",
                "group": "general"
            },
            "ev": {
                "name": "Event",
                "group": "general"
            },
            "pl": {
                "name": "Page URL",
                "group": "general"
            },
            "ts": {
                "name": "Timestamp",
                "group": "other"
            },
            "rf": {
                "name": "Referrer",
                "group": "general"
            },
            "v": {
                "name": "Pixel Version",
                "group": "other"
            },
            "u_hem": {
                "name": "User Email (Hashed)",
                "group": "general"
            },
            "u_hpn": {
                "name": "User Phone Number (Hashed)",
                "group": "general"
            },
            "e_desc": {
                "name": "Description",
                "group": "events"
            },
            "e_sm": {
                "name": "Sign Up Method",
                "group": "events"
            },
            "e_su": {
                "name": "Success",
                "group": "events"
            },
            "e_ni": {
                "name": "Number of Items",
                "group": "ecommerce"
            },
            "e_iids": {
                "name": "Item IDs",
                "group": "ecommerce"
            },
            "e_ic": {
                "name": "Item Category",
                "group": "ecommerce"
            },
            "e_pia": {
                "name": "Payment Info Available",
                "group": "ecommerce"
            },
            "e_cur": {
                "name": "Currency",
                "group": "ecommerce"
            },
            "e_pr": {
                "name": "Price",
                "group": "ecommerce"
            },
            "e_tid": {
                "name": "Transaction ID",
                "group": "ecommerce"
            },
            "e_ss": {
                "name": "Search Keyword",
                "group": "events"
            }
        };
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "") {
        let params = [];
        // Handle POST data first, if applicable (treat as query params)
        /* istanbul ignore else: fallback */
        if (typeof postData === "string" && postData !== "") {
            let keyPairs = postData.split("&");
            keyPairs.forEach((keyPair) => {
                let splitPair = keyPair.split("=");
                params.push([splitPair[0], decodeURIComponent(splitPair[1] || "")]);
            });
        } else if (typeof postData === "object") {
            Object.entries(postData).forEach((entry) => {
                // @TODO: consider handling multiple values passed?
                params.push([entry[0], entry[1].toString()]);
            });
        }
        return params;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            event = params.get("ev") || /* istanbul ignore next: fallback */ "other",
            requestType = event.toLowerCase();
        
        requestType = requestType.split("_").map(word => {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(" ");

        results.push({
            "key": "requestType",
            "value": requestType,
            "hidden": true
        });

        return results;
    }
}
/**
 * Sojern
 * https://www.sojern.com/
 *
 * @class
 * @extends BaseProvider
 */
class SojernProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "SOJERN";
        this._pattern = /beacon\.sojern\.com/;
        this._name = "Sojern";
        this._type = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "pixelId",
            "requestType": "pt"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "hotel",
                "name": "Hotels"
            },
            {
                "key": "flight",
                "name": "Flights"
            },
            {
                "key": "cruise",
                "name": "Cruises"
            },
            {
                "key": "car",
                "name": "Cars"
            },
            {
                "key": "entertainment",
                "name": "Entertainment"
            },
            {
                "key": "rail",
                "name": "Rail"
            },
            {
                "key": "vacation",
                "name": "Vacation"
            }
        ];
    }

    /**
     * Get all the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "be": {
                "name": "Booking Engine Key",
                "group": "general"
            },
            "md5_eml": {
                "name": "Hashed Email (MD5)",
                "group": "general"
            },
            "sha1_eml": {
                "name": "Hashed Email (SHA1)",
                "group": "general"
            },
            "sha256_eml": {
                "name": "Hashed Email (SHA256)",
                "group": "general"
            },
            "ffl": {
                "name": "Loyalty Status",
                "group": "general"
            },
            "t": {
                "name": "Number of Travelers",
                "group": "general"
            },
            "tad": {
                "name": "Number of Adults",
                "group": "general"
            },
            "tch": {
                "name": "Number of Children",
                "group": "general"
            },
            "pgid": {
                "name": "Page ID",
                "group": "general"
            },
            "pname": {
                "name": "Page Name",
                "group": "general"
            },
            "pc": {
                "name": "Page Category",
                "group": "general"
            },
            "pt": {
                "name": "Page Type",
                "group": "general"
            },
            "ppot": {
                "name": "Purpose of Travel",
                "group": "general"
            },
            "rpnow": {
                "name": "Pay Now or Later",
                "group": "general"
            },
            "pn": {
                "name": "Product Name",
                "group": "general"
            },
            "fow": {
                "name": "One Way",
                "group": "general"
            },
            "fmc": {
                "name": "Multi-City",
                "group": "general"
            },
            "ptr": {
                "name": "Pets Traveling",
                "group": "general"
            },
            "pixelId": {
                "name": "Pixel ID",
                "group": "general"
            },
            "domain": {
                "name": "Domain",
                "group": "general"
            },
            "s": {
                "name": "debug",
                "group": "other"
            },
            "rphn": {
                "name": "Phone Number",
                "group": "general"
            },
            "md5_phn": {
                "name": "Phone Number (MD5)",
                "group": "general"
            },
            "sha1_phn": {
                "name": "Phone Number (SHA1)",
                "group": "general"
            },
            "sha256_phn": {
                "name": "Phone Number (SHA256)",
                "group": "general"
            },
            "sjrn_click_campaign_id": {
                "name": "Click Campaign ID",
                "group": "general"
            },
            "sjrn_click_placement_id": {
                "name": "Click Placement ID",
                "group": "general"
            },
            "sjrn_click_id": {
                "name": "Click ID",
                "group": "general"
            },
            "auto_out": {
                "name": "Auto Cookieless Opt-Out",
                "group": "other"
            },
            "dnf": {
                "name": "Do Not Fire",
                "group": "other"
            },
            "ccid": {
                "name": "Client Cookie ID",
                "group": "other"
            },
            "hb": {
                "name": "Hotel Brand",
                "group": "hotel"
            },
            "hpid": {
                "name": "Hotel Property ID",
                "group": "hotel"
            },
            "hpr": {
                "name": "Hotel Property",
                "group": "hotel"
            },
            "hcu": {
                "name": "Currency Code",
                "group": "hotel"
            },
            "hc1": {
                "name": "Hotel City",
                "group": "hotel"
            },
            "hs1": {
                "name": "Hotel State",
                "group": "hotel"
            },
            "hn1": {
                "name": "Hotel Country",
                "group": "hotel"
            },
            "hd": {
                "name": "Number of Nights",
                "group": "hotel"
            },
            "hd1": {
                "name": "Check In Date",
                "group": "hotel"
            },
            "hd2": {
                "name": "Check Out Date",
                "group": "hotel"
            },
            "ha1": {
                "name": "Nearest Airport",
                "group": "hotel"
            },
            "hr": {
                "name": "Number of Rooms",
                "group": "hotel"
            },
            "hc": {
                "name": "Room Type",
                "group": "hotel"
            },
            "hrp": {
                "name": "Rate Plan",
                "group": "hotel"
            },
            "hsr": {
                "name": "Star Rating",
                "group": "hotel"
            },
            "hoh": {
                "name": "Home Hotel",
                "group": "hotel"
            },
            "fd1": {
                "name": "Departure Date",
                "group": "flight"
            },
            "fd2": {
                "name": "Return Date",
                "group": "flight"
            },
            "fd": {
                "name": "Number of Nights",
                "group": "flight"
            },
            "fc": {
                "name": "Service Class",
                "group": "flight"
            },
            "ffc": {
                "name": "Fare Code",
                "group": "flight"
            },
            "fc2": {
                "name": "Origin City",
                "group": "flight"
            },
            "fs2": {
                "name": "Origin State",
                "group": "flight"
            },
            "fn2": {
                "name": "Origin Country",
                "group": "flight"
            },
            "fa1": {
                "name": "Origin Airport",
                "group": "flight"
            },
            "fc1": {
                "name": "Destination City",
                "group": "flight"
            },
            "fs1": {
                "name": "Destination State",
                "group": "flight"
            },
            "fn1": {
                "name": "Destination Country",
                "group": "flight"
            },
            "fa2": {
                "name": "Destination airport",
                "group": "general"
            },
            "fan": {
                "name": "Flight Company Name",
                "group": "general"
            },
            "lyvr": {
                "name": "Layover Airport #1",
                "group": "general"
            },
            "lyvr2": {
                "name": "Layover Airport #2",
                "group": "general"
            },
            "lyvr3": {
                "name": "Layover Airport #3",
                "group": "general"
            },



            "cd1": {
                "name": "Departure Date",
                "group": "cruise"
            },
            "cd2": {
                "name": "Return Date",
                "group": "cruise"
            },
            "ca1": {
                "name": "Nearest Departure Port Airport",
                "group": "cruise"
            },
            "cf2": {
                "name": "Departure City",
                "group": "cruise"
            },
            "cs2": {
                "name": "Departure State",
                "group": "cruise"
            },
            "cn2": {
                "name": "Departure Country",
                "group": "cruise"
            },
            "ca2": {
                "name": "Nearest Arrival Port Airport",
                "group": "cruise"
            },
            "cf1": {
                "name": "Arrival City",
                "group": "cruise"
            },
            "cs1": {
                "name": "Arrival State",
                "group": "cruise"
            },
            "cn1": {
                "name": "Arrival Country",
                "group": "cruise"
            },
            "cd": {
                "name": "Number of Nights",
                "group": "cruise"
            },
            "crl": {
                "name": "Number of Days",
                "group": "cruise"
            },
            "creg": {
                "name": "Region",
                "group": "cruise"
            },
            "cco": {
                "name": "Cruise Line",
                "group": "cruise"
            },
            "csh": {
                "name": "Cruise Ship",
                "group": "cruise"
            },
            "cm": {
                "name": "Cruise Month",
                "group": "cruise"
            },
            "cc": {
                "name": "Cruise Class",
                "group": "cruise"
            },
            "cr": {
                "name": "Number of Rooms",
                "group": "cruise"
            },
            "vt": {
                "name": "Attraction Type",
                "group": "cruise"
            },
        };
    }
}

/**
 * SplitIO Events and Impressions
 *
 * @class
 * @extends BaseProvider
 */
class SplitIOProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "SPLITIO";
        this._pattern = /events\.split\.io\/api\/(events\/(beacon|bulk)|testImpressions\/(count\/beacon|beacon|bulk))/;
        this._name = "SplitIO";
        this._type = "analytics";
        this._keywords = ["splitio", "abtest", "insight"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "preview",
            "requestType": "requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse a given URL into human-readable output
     *
     * @param {string}  rawUrl      A URL to check against
     * @param {string}  postData    POST data, if applicable
     *
     * @return {{provider: {name: string, key: string, type: string}, data: Array}}
     */
    parseUrl(rawUrl, postData = "") {
        const url = new URL(rawUrl);

        return {
            "provider": {
                "name": this.name,
                "key": this.key,
                "type": this.type,
                "columns": this.columnMapping,
                "groups": this.groups
            },
            "data": this.buildData(url, postData)
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {URL}   url
     * @param    {string}   postData
     *
     * @returns {Array}
     */
    buildData(url, postData) {
        const parsedData = JSON.parse(postData);
        const isBeacon = url.pathname.includes("beacon");
        const isEvents = url.pathname.includes("events");
        let entries;
        if (isEvents || !url.pathname.includes("count")) {
            entries = (isBeacon ? parsedData.entries : parsedData) || [];
        } else {
            entries = parsedData.entries.pf;
        }

        const metadata = isBeacon ? [{
            "key": "token",
            "value": parsedData.token,
            "field": "API Key",
            "group": "other",
        }, {
            "key": "sdk",
            "value": parsedData.sdk,
            "field": "SDK",
            "group": "other",
        }] : [];

        const contents = entries.flatMap((entry, i) => isEvents ? [{
            "key": "eventName",
            "value": entry.eventTypeId,
            "field": `Event ${i + 1} Name`,
            "group": "general"
        }, {
            "key": "eventProperties",
            "value": JSON.stringify(entry.properties, undefined, 2),
            "field": `Event ${i + 1} Properties`,
            "group": "general"
        }, {
            "key": "eventAttributes",
            "value": JSON.stringify({trafficType: entry.trafficTypeName, value: entry.value, sdk: entry.sdk}, undefined, 2),
            "field": `Event ${i + 1} Attributes`,
            "group": "general"
        }] : [{
            "key": "splitName",
            "value": entry.f,
            "field": `Split ${i + 1} Name`,
            "group": "general"
        }]);

        return [
            {
                "key": "preview",
                "value": entries.map(e => isEvents ? e.eventTypeId : e.f).join(","),
                "field": "Preview",
                "group": "other",
                "hidden": true
            },
            {
                "key": "transferType",
                "value": isBeacon ? "beacon" : "bulk (sdk)",
                "field": "Transfer type",
                "group": "other",
            },
            {
                "key": "requestType",
                "value": (isEvents ? "Events" : "Impressions") + " (" + entries.length + ")",
                "field": "Request type",
                "group": "other",
            },
            ...metadata,
            ...contents,
        ];
    }
}

/**
 * Spotify Pixel
 * https://help.adanalytics.spotify.com/technical-pixel-docs
 *
 * @class
 * @extends BaseProvider
 */
class SpotifyPixelProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "SPOTIFYPIXEL";
        this._pattern    = /pixels\.spotify\.com\/v1\/ingest/;
        this._name       = "Spotify Pixel";
        this._type       = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "pid",
            "requestType":  "omnibug_requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "events",
                "name": "Events"
            },
        ];
    }

    /**
     * Get all the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "pid": {
                "name": "Pixel ID",
                "group": "general"
            },
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value) {

        let result = {};
        if(/^events\[(\d+)]\.(.+)$/.test(name)) {
            const eventNumber = (parseInt(RegExp.$1) || 0) + 1;
            result = {
                "key": name,
                "field": `Event ${eventNumber} ${RegExp.$2}`,
                "value": value,
                "group": "events"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse any POST data into param key/value pairs
     *
     * @param postData
     * @return {Array|Object}
     */
    parsePostData(postData = "")
    {
        if(typeof postData === "string" && postData)
        {
            try
            {
                let parsed = JSON.parse(postData);
                // Remove the batch parameters if there is only one hit
                if(parsed && Array.isArray(parsed.batch) && parsed.batch.length === 1) {
                    postData = JSON.stringify(parsed.batch[0]);
                }
            }
            catch(e)
            {
                console.error("postData is not JSON", e.message);
            }
        }
        return super.parsePostData(postData);
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            requestType = "";

        const types = Array.from(params.entries())
            .filter(([key, ]) => {
                return /events\[\d+]\.action$/.test(key);
            }).map(([, hitType]) => {
                return hitType.toLowerCase();
            });

        if(types.length > 1) {
            requestType = `(${types.length}) ${types.join(", ")}`;
        } else if(types.length === 1) {
            requestType = types.pop();
        } else {
            requestType = "Other";
        }
        results.push({
            "key":    "omnibug_requestType",
            "value":  requestType,
            "hidden": true
        });
        return results;
    }
}

/**
 * Teads Universal Pixel
 * 
 * @class
 * @extends BaseProvider
 */
class TeadsProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "TEADS";
        this._pattern = /https:\/\/t\.teads\.tv\/track(?:.*[&#?]tag_version=)/;
        this._name = "Teads";
        this._type = "marketing";
        this._keywords = ["Teads"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     * 
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "buyer_pixel_id",
            "requestType": "action"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {};
    }
}

/**
 * Tealium EventStream
 * https://tealium.com/products/tealium-eventstream/
 *
 * @class
 * @extends BaseProvider
 */
class TealiumEventStreamProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "TEALIUMEVENTSTREAM";
        this._pattern    = /collect\.tealiumiq\.com\/event/;
        this._name       = "Tealium EventStream";
        this._type       = "tagmanager";
        this._keywords   = ["tms", "server"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "omnibug_account",
            "requestType":  "tealium_event"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "browser",
                "name": "Browser Data"
            },
            {
                "key": "dom",
                "name": "DOM Data"
            },
            {
                "key": "js_var",
                "name": "JavaScript UDO Variables"
            },
            {
                "key": "meta",
                "name": "Meta Data"
            },
            {
                "key": "mouse",
                "name": "Mouse Data"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "tealium_event": {
                "name": "Event Name",
                "group": "general"
            },
            "tealium_environment": {
                "name": "Environment",
                "group": "general"
            },
            "tealium_profile": {
                "name": "Profile",
                "group": "general"
            },
            "tealium_account": {
                "name": "Account ID",
                "group": "general"
            },
            "tealium_datasource": {
                "name": "Data Source",
                "group": "general"
            },
            "tealium_visitor_id": {
                "name": "Visitor ID",
                "group": "general"
            },
            "tealium_session_id": {
                "name": "Session ID",
                "group": "general"
            },
            "tealium_session_number": {
                "name": "Session Number",
                "group": "general"
            },
            "tealium_library_name": {
                "name": "Library Name",
                "group": "general"
            },
            "tealium_library_version": {
                "name": "Library Version",
                "group": "general"
            },
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value) {

        let result = {};
        if(/^browser\.(.+)$/.test(name)) {
            result = {
                "key": name,
                "field": RegExp.$1,
                "value": value,
                "group": "browser"
            };
        } else if(/^dom\.(.+)$/.test(name)) {
            result = {
                "key": name,
                "field": RegExp.$1,
                "value": value,
                "group": "dom"
            };
        } else if(/^js_page\.(.+)$/.test(name)) {
            result = {
                "key": name,
                "field": RegExp.$1,
                "value": value,
                "group": "js_page"
            };
        } else if(/^meta\.(.+)$/.test(name)) {
            result = {
                "key": name,
                "field": RegExp.$1,
                "value": value,
                "group": "meta"
            };
        } else if(/^_mouse_(.+)$/.test(name)) {
            result = {
                "key": name,
                "field": RegExp.$1,
                "value": value,
                "group": "mouse"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        return [
            {
                "key":   "omnibug_hostname",
                "field": "Hostname",
                "value": url.hostname,
                "group": "general"
            },
            {
                "key":   "omnibug_account",
                "value": `${params.get("tealium_account")} / ${params.get("tealium_profile")}`,
                "hidden": true
            },
        ];
    }
}

/**
 * Tealium iQ
 * https://tealium.com/products/tealium-iq-tag-management-system/
 *
 * @class
 * @extends BaseProvider
 */
class TealiumIQProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "TEALIUMIQ";
        this._pattern    = /\/[^/]+\/[^/]+\/utag(\.sync)?\.js/;
        this._name       = "Tealium iQ";
        this._type       = "tagmanager";
        this._keywords   = ["tms"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "omnibug_account",
            "requestType":  "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            }
        ];
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let matches =  url.pathname.match(/([^/]+)\/([^/]+)\/(utag(?:\.sync)?\.js)/),
            results = [],
            account = null;

        // When hosted on a first party domain, the account field does not exist
        if(/^\/utag\/([^/]+)\//.test(url.pathname)) {
            account = url.pathname.match(/^\/utag\/([^/]+)\//)[1];
        }

        if(matches !== null && matches.length === 4) {
            if(account) {
                results.push({
                    "key":   "omnibug_account",
                    "value": `${account} / ${matches[1]}`,
                    "hidden": true
                });
                results.push({
                    "key":   "acccount",
                    "field": "Account",
                    "value": account,
                    "group": "general"
                });
            } else {
                results.push({
                    "key":   "omnibug_account",
                    "value": matches[1],
                    "hidden": true
                });
            }

            results.push({
                "key":   "profile",
                "field": "Profile",
                "value": matches[1],
                "group": "general"
            });
            results.push({
                "key":   "environment",
                "field": "Environment",
                "value": matches[2],
                "group": "general"
            });
            results.push({
                "key":   "requestType",
                "value": ((matches[3] === "utag.js") ? "Async" : "Sync") + " Library Load",
                "hidden": true
            });
        }

        return results;
    }
}

/**
 * The Trade Desk - Universal Pixel
 * https://partner.thetradedesk.com/v3/portal/data/doc/TrackingTagsUniversalPixel
 * 
 * @class
 * @extends BaseProvider
 */
class TheTradeDeskUniversalProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "TDDUNIVERSAL";
        this._pattern = /insight\.adsrvr\.org\/track\/up/;
        this._name = "The Trade Desk";
        this._type = "marketing";
        this._keywords = ["TDD"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     * The account is unique to each TikTok pixel event, meaning multiple events firing from the same pixel SDK will have discreet identifiers
     * 
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "_account"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "conversion",
                "name": "Conversion"
            },
            {
                "key": "dynamic",
                "name": "Dynamic Parameters"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "adv": {
                "name": "Advertiser ID",
                "group": "general"
            },
            "upid": {
                "name": "Universal Pixel ID",
                "group": "general"
            },
            "v": {
                "name": "Revenue",
                "group": "conversion"
            },
            "vf": {
                "name": "Currency Code",
                "group": "conversion"
            },
            "orderid": {
                "name": "Order ID",
                "group": "conversion"
            },
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value)
    {
        if(/^td\d+$/i.test(name)) {
            return {
                "key":   name,
                "field": name,
                "value": value,
                "group": "dynamic"
            };
        }
        return super.handleQueryParam(name, value);
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {void|Array}
     */
    handleCustom(url, params)
    {
        let results = [];

        results.push({
            "key":   "_account",
            "value": `${params.get("adv")} / ${params.get("upid")}`,
            "hidden": true
        });


        return results;
    } // handle custom
}

/**
 * TikTok Tracking Events
 * No public documentation is available for the TikTok standard events, which must be defined in the TikTok Ads platform (not in GTM, etc.)
 * Events are currently being sent to API v1, but the provider regex is built to support future API versions (e.g. v2, v3, etc.)
 * 
 * @class
 * @extends BaseProvider
 */
class TikTokProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "TIKTOK";
        this._pattern = /https:\/\/analytics\.tiktok\.com\/api\/v[0-9]\/(?:track|pixel)/;
        this._name = "TikTok";
        this._type = "marketing";
        this._keywords = ["TikTok"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     * The account is unique to each TikTok pixel event, meaning multiple events firing from the same pixel SDK will have discreet identifiers
     * 
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":     "context.pixel.code",
            "requestType": "event"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "event",
                "name": "Event"
            },
            {
                "key": "context",
                "name": "Context"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "event": {
                "name": "Event",
                "group": "event"
            },
            "sdkid": {
                "name": "SDK ID",
                "group": "event"
            },
            "analytics_uniq_id": {
                "name": "Analytics Unique ID",
                "group": "event"
            },
            "timestamp": {
                "name": "Timestamp",
                "group": "event"
            },
            "context.ad.ad_id": {
                "name": "Ad ID",
                "group": "context"
            },
            "context.ad.callback": {
                "name": "Ad Callback",
                "group": "context"
            },
            "context.ad.convert_id": {
                "name": "Ad Conversion ID",
                "group": "context"
            },
            "context.ad.creative_id": {
                "name": "Ad Creative ID",
                "group": "context"
            },
            "context.ad.idc": {
                "name": "Ad IDC",
                "group": "context"
            },
            "context.ad.log_extra": {
                "name": "Ad Log Extra",
                "group": "context"
            },
            "context.ad.req_id": {
                "name": "Ad Request ID",
                "group": "context"
            },
            "context.library.name": {
                "name": "Library Name",
                "group": "context"
            },
            "context.library.version": {
                "name": "Library Version",
                "group": "context"
            },
            "context.page.referrer": {
                "name": "Page Referrer",
                "group": "context"
            },
            "context.page.url": {
                "name": "Page URL",
                "group": "context"
            },
            "context.pixel.code": {
                "name": "Pixel Code",
                "group": "context"
            },
            "context.user.device_id": {
                "name": "Device ID",
                "group": "context"
            },
            "context.user.user_id": {
                "name": "User ID",
                "group": "context"
            }
        };
    }
}

/**
 * Twitter Conversions
 * https://business.twitter.com/
 *
 * @class
 * @extends BaseProvider
 */
class TwitterProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "TWITTERPIXEL";
        this._pattern = /analytics\.twitter\.com\/i\/adsct/;
        this._name = "Twitter Conversion";
        this._type = "marketing";
        this._keywords = ["twitter", "t.co", "tweet", "uwt.js", "oct.js"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "txn_id",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General"
            },
            {
                "key": "events",
                "name": "Events"
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "txn_id": {
                "name": "Tag ID",
                "group": "general"
            },
            "p_id": {
                "name": "Pixel Type",
                "group": "general"
            },
            "p_user_id": {
                "name": "User ID",
                "group": "general"
            },
            "events": {
                "name": "Event Data",
                "group": "general"
            },
            "tw_sale_amount": {
                "name": "Revenue",
                "group": "general"
            },
            "tw_order_quantity": {
                "name": "Quantity",
                "group": "general"
            },
            "tpx_cb": {
                "name": "Callback",
                "group": "other"
            },
            "tw_iframe_status": {
                "name": "Is an iFrame",
                "group": "other"
            },
            "tw_document_href": {
                "name": "Page URL",
                "group": "other"
            }
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            events = params.get("events"),
            requestType = "other";

        /* istanbul ignore else: nothing happens */
        if (events) {
            try {
                let parsedEvents = JSON.parse(events),
                    requestTypes = [];

                (parsedEvents || /* istanbul ignore next: fallback */[]).forEach(([type, ...data]) => {
                    type = type === "pageview" ? "Page View" : type;
                    requestTypes.push(type);
                });
                requestType = requestTypes.join("|");
            } catch (e) {
                /* istanbul ignore next */
                console.error(e.message);
            }
        }

        results.push({
            "key": "requestType",
            "value": requestType,
            "hidden": true
        });

        return results;
    }
}
/**
 * Vibes
 * https://developer-platform.vibes.com/docs/implementing-vibes-tags
 *
 * @class
 * @extends BaseProvider
 */
class VibesProvider extends BaseProvider
{
    constructor()
    {
        super();
        this._key        = "VIBES";
        this._pattern    = /tagtracking\.(?:vibescm\.com|eu\.vibes\.com)\/track/;
        this._name       = "Vibes";
        this._type       = "marketing";
        this._keywords   = [];
    }
}

/**
 * WebTrends OnDemand
 * https://www.webtrends.com/
 *
 * @class
 * @extends BaseProvider
 */
class WebtrendsOnDemandProvider extends BaseProvider {
    constructor() {
        super();
        this._key = "WEBTRENDSONDEMAND";
        this._pattern = /\/dcs\.gif/;
        this._name = "Webtrends OnDemand";
        this._type = "analytics";
        this._keywords = ["webtrends", "analytics", "ondemand", "on demand"];
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping() {
        return {
            "account": "accountID",
            "requestType": "requestType"
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups() {
        return [
            {
                "key": "general",
                "name": "General",
            },
            {
                "key": "marketing",
                "name": "Marketing / Traffic Source",
            },
            {
                "key": "scenario",
                "name": "Scenario Analysis",
            },
            {
                "key": "ecom",
                "name": "E-commerce",
            },
            {
                "key": "clicks",
                "name": "Click Event",
            },
            {
                "key": "search",
                "name": "Site Search",
            },
            {
                "key": "headers",
                "name": "Captured HTTP Headers",
            }
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys() {
        return {
            "WT.vt_tlv": {
                "name": "Time of last visit (SDC)",
                "group": "other"
            },
            "WT.vt_f_tlv": {
                "name": "Time of last visit (cookie)",
                "group": "other"
            },
            "WT.vt_f_tlh": {
                "name": "Time of last hit",
                "group": "other"
            },
            "WT.vt_d": {
                "name": "First visitor hit today (EA)",
                "group": "other"
            },
            "WT.vt_a_d": {
                "name": "First visitor hit today (ARDS)",
                "group": "other"
            },
            "WT.s": {
                "name": "First visitor hit this account (ARDS)",
                "group": "other"
            },
            "WT.vt_f_d": {
                "name": "First visitor hit today (cookie)",
                "group": "other"
            },
            "WT.vt_s": {
                "name": "First visitor hit this session",
                "group": "other"
            },
            "WT.vt_f_s": {
                "name": "First visitor hit this session (cookie)",
                "group": "other"
            },
            "WT.vt_f": {
                "name": "First visitor hit (cookie)",
                "group": "other"
            },
            "WT.vt_f_a": {
                "name": "First visitor hit this account (cookie)",
                "group": "other"
            },
            "WT.vtid": {
                "name": "Session ID",
                "group": "general"
            },
            "WT.dcsvid": {
                "name": "User ID",
                "group": "general"
            },
            "WT.vtvs": {
                "name": "Visitor session (timestamp)",
                "group": "other"
            },
            "WT.co": {
                "name": "Client accepting cookies",
                "group": "other"
            },
            "WT.ce": {
                "name": "Cookie type (first/third party)",
                "group": "other"
            },
            "WT.co_d": {
                "name": "Session stitching ID",
                "group": "other"
            },
            "WT.co_a": {
                "name": "Multi account rollup ID",
                "group": "general"
            },
            "WT.co_f": {
                "name": "Visitor session ID",
                "group": "general"
            },
            "WT.tu": {
                "name": "Metrics URL truncated",
                "group": "other"
            },
            "WT.hdr": {
                "name": "Custom HTTP header tracking",
                "group": "other"
            },
            "WT.tv": {
                "name": "Webtrends JS tag version",
                "group": "general"
            },
            "WT.site": {
                "name": "Site ID",
                "group": "general"
            },
            "WT.tsrc": {
                "name": "Custom traffic source",
                "group": "marketing"
            },
            "WT.nv": {
                "name": "Parent div/table ID",
                "group": "clicks"
            },
            "WT.es": {
                "name": "Event source",
                "group": "clicks"
            },
            "WT.dcs_id": {
                "name": "DCSID",
                "group": "general"
            },
            "WT.cg_n": {
                "name": "Content group name",
                "group": "general"
            },
            "WT.cg_s": {
                "name": "Content sub-group name",
                "group": "general"
            },
            "WT.mc_id": {
                "name": "Marketing campaign",
                "group": "marketing"
            },
            "WT.mc_ev": {
                "name": "Marketing campaign clickthrough",
                "group": "marketing"
            },
            "WT.ad": {
                "name": "Advertising view",
                "group": "marketing"
            },
            "WT.ac": {
                "name": "Advertising click",
                "group": "marketing"
            },
            "WT.sv": {
                "name": "Server name",
                "group": "general"
            },
            "WT.si_n": {
                "name": "Scenario name",
                "group": "scenario"
            },
            "WT.si_p": {
                "name": "Scenario step name",
                "group": "scenario"
            },
            "WT.si_x": {
                "name": "Scenario step position",
                "group": "scenario"
            },
            "WT.si_cs": {
                "name": "Scenario conversion",
                "group": "scenario"
            },
            "WT.ti": {
                "name": "Page title",
                "group": "general"
            },
            "WT.sp": {
                "name": "Split log file",
                "group": "general"
            },
            "WT.srch": {
                "name": "Search engine type",
                "group": "marketing"
            },
            "WT.tz": {
                "name": "Browser time zone",
                "group": "other"
            },
            "WT.bh": {
                "name": "Browser time (hour)",
                "group": "other"
            },
            "WT.ul": {
                "name": "Browser language",
                "group": "other"
            },
            "WT.cd": {
                "name": "Color depth",
                "group": "other"
            },
            "WT.sr": {
                "name": "Screen resolution",
                "group": "other"
            },
            "WT.js": {
                "name": "JavaScript enabled",
                "group": "other"
            },
            "WT.jv": {
                "name": "JavaScript version",
                "group": "other"
            },
            "WT.jo": {
                "name": "Java enabled",
                "group": "other"
            },
            "WTT.jo": {
                "name": "Cookie type",
                "group": "other"
            },
            "WT.slv": {
                "name": "Silverlight enabled",
                "group": "other"
            },
            "WT.fv": {
                "name": "Flash version",
                "group": "other"
            },
            "WT.ct": {
                "name": "Connection Type",
                "group": "other"
            },
            "WT.hp": {
                "name": "Page is browser's homepage",
                "group": "other"
            },
            "WT.bs": {
                "name": "Browser resolution",
                "group": "other"
            },
            "WT.le": {
                "name": "Browser charset",
                "group": "other"
            },
            "WT.pn_sku": {
                "name": "Product SKU",
                "group": "ecom"
            },
            "WT.pn_id": {
                "name": "Product ID",
                "group": "ecom"
            },
            "WT.pn_fa": {
                "name": "Product family",
                "group": "ecom"
            },
            "WT.pn_gr": {
                "name": "Product group",
                "group": "ecom"
            },
            "WT.pn_sc": {
                "name": "Product sub-category",
                "group": "ecom"
            },
            "WT.pn_ma": {
                "name": "Product manufacturer",
                "group": "ecom"
            },
            "WT.pn_su": {
                "name": "Product supplier",
                "group": "ecom"
            },
            "WT.tx_u": {
                "name": "Transaction total quantity",
                "group": "ecom"
            },
            "WT.tx_s": {
                "name": "Transaction total cost",
                "group": "ecom"
            },
            "WT.tx_e": {
                "name": "Transaction type",
                "group": "ecom"
            },
            "WT.tx_i": {
                "name": "Transaction ID",
                "group": "ecom"
            },
            "WT.tx_id": {
                "name": "Transaction date",
                "group": "ecom"
            },
            "WT.tx_it": {
                "name": "Transaction time",
                "group": "ecom"
            },
            "WT.pi": {
                "name": "Page ID",
                "group": "general"
            },
            "WT.oss": {
                "name": "Site search term",
                "group": "search"
            },
            "WT.oss_r": {
                "name": "Site search result count",
                "group": "search"
            },
            "WT.rv": {
                "name": "Registered visitor",
                "group": "general"
            },
            "dcsid": {
                "name": "Account ID",
                "group": "general"
            },
            "dcsref": {
                "name": "Page referer",
                "group": "general"
            },
            "dcssip": {
                "name": "Page domain",
                "group": "general"
            },
            "dcsuri": {
                "name": "Page path",
                "group": "general"
            },
            "dcsua": {
                "name": "User-Agent ",
                "group": "other"
            },
            "dcspro": {
                "name": "Page protocol",
                "group": "general"
            },
            "dcsqry": {
                "name": "Page query string",
                "group": "general"
            },
            "dcsaut": {
                "name": "Auth username",
                "group": "general"
            },
            "dcsmet": {
                "name": "Method",
                "group": "other"
            },
            "dcssta": {
                "name": "Status",
                "group": "other"
            },
            "dcsbyt": {
                "name": "Request size",
                "group": "other"
            },
            "dcscip": {
                "name": "IP Address",
                "group": "other"
            },
            "dcsdat": {
                "name": "Cache buster",
                "group": "other"
            },
            "WT.ssl": {
                "name": "Page is SSL",
                "group": "other"
            },
        };
    }

    /**
     * Parse a given URL parameter into human-readable form
     *
     * @param {string}  name
     * @param {string}  value
     *
     * @returns {void|{}}
     */
    handleQueryParam(name, value) {
        // Double encoded values plague WT params...
        value = decodeURIComponent(value);

        let result = {};
        if (name === "WT.dl") {
            result = {
                "key": name,
                "field": "Event Type",
                "value": `${value} (${this._getRequestType(value)})`,
                "group": "general"
            };
        } else if (/^WT\.hdr\.(.*)/i.test(name)) {
            result = {
                "key": name,
                "field": RegExp.$1,
                "value": value,
                "group": "headers"
            };
        } else if (/^(?:WT\.seg_)(\d+)$/i.test(name)) {
            result = {
                "key": name,
                "field": "Segment of interest " + RegExp.$1,
                "value": value,
                "group": "general"
            };
        } else {
            result = super.handleQueryParam(name, value);
        }
        return result;
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params) {
        let results = [],
            accountID = url.pathname.match(/^\/([^/]+)\/dcs\.gif/),
            requestType = this._getRequestType(params.get("WT.dl"));

        if (accountID) {
            results.push({
                "key": "accountID",
                "field": "Account ID",
                "value": accountID[1],
                "group": "general",
            });
        }

        results.push({
            "key": "requestType",
            "value": requestType,
            "hidden": true
        });
        return results;
    }

    /**
     * Get the request type based on the key
     * https://help.webtrends.com/legacy/en/Analytics10/event_tracking.html
     *
     * @param key
     * @returns string
     * @private
     */
    _getRequestType(key) {
        let table = {
            0: "Page View",
            20: "Download Click",
            21: "Anchor Click",
            22: "javascript: Click",
            23: "mailto: Click",
            24: "Exit Click",
            25: "Right-Click",
            26: "Form Submit - GET",
            27: "Form Submit - POST",
            28: "Form Button Click - Input",
            29: "Form Button Click - Button",
            30: "Image Map Click"
        };
        return table[key] || key;
    }
}

/**
 * Zemanta
 * https://www.zemanta.com/
 *
 * @class
 * @extends BaseProvider
 */

class ZemantaProvider extends BaseProvider {
    constructor() {
        super();
        this._key       = "ZEMANTA";
        this._pattern   = /zemanta\.com\/(?:v2\/)?p\//;
        this._name      = "Zemanta";
        this._type      = "marketing";
    }

    /**
     * Retrieve the column mappings for default columns (account, event type)
     *
     * @return {{}}
     */
    get columnMapping()
    {
        return {
            "account":      "omnibug_id",
            "requestType":  "omnibug_requestType",
        };
    }

    /**
     * Retrieve the group names & order
     *
     * @returns {*[]}
     */
    get groups()
    {
        return [
            {
                "key": "general",
                "name": "General"
            },
        ];
    }

    /**
     * Get all of the available URL parameter keys
     *
     * @returns {{}}
     */
    get keys()
    {
        return {
            "id" : {
                "name": "Pixel ID",
                "group": "general"
            },
        };
    }

    /**
     * Parse custom properties for a given URL
     *
     * @param    {string}   url
     * @param    {object}   params
     *
     * @returns {Array}
     */
    handleCustom(url, params)
    {
        let results = [],
            legacyPixel = /^\/p\//.test(url.pathname),
            pixelVersion = url.pathname.match(/^\/(v\d+)\//i),
            pixelID = url.pathname.match(/\/p\/(?:js\/)?(\d+)\//i),
            eventType = url.pathname.match(/\/js\/\d+\/([^/]+)?/i),
            requestType = "Page View";

        results.push({
            "key":   "pixelType",
            "field": "Pixel Type",
            "value": legacyPixel || ! pixelVersion ? "Legacy" : pixelVersion[1],
            "group": "general",
        });

        results.push({
            "key":   "omnibug_id",
            "field": "Pixel ID",
            "value": pixelID ? pixelID[1] : null,
            "group": "general",
        });
        if(eventType && eventType[1] !== "PAGE_VIEW") {
            requestType = eventType[1];
        }
        results.push({
            "key":   "omnibug_requestType",
            "value": requestType,
            "hidden": true
        });
        return results;
    }
}

OmnibugProvider.addProvider(new AdformProvider());
OmnibugProvider.addProvider(new AdobeAnalyticsProvider());
OmnibugProvider.addProvider(new AdobeAudienceManagerProvider());
OmnibugProvider.addProvider(new AdobeDynamicTagManagerProvider());
OmnibugProvider.addProvider(new AdobeExperienceIDProvider());
OmnibugProvider.addProvider(new AdobeHeartbeatProvider());
OmnibugProvider.addProvider(new AdobeLaunchProvider());
OmnibugProvider.addProvider(new AdobeLaunchCNProvider());
OmnibugProvider.addProvider(new AdobeTargetProvider());
OmnibugProvider.addProvider(new AdobeWebSdkProvider());
OmnibugProvider.addProvider(new AmazonAdTagProvider());
OmnibugProvider.addProvider(new AmplitudeProvider());
OmnibugProvider.addProvider(new ATInternetProvider());
OmnibugProvider.addProvider(new BingAdsProvider());
OmnibugProvider.addProvider(new BrazeProvider());
OmnibugProvider.addProvider(new BrevoProvider());
OmnibugProvider.addProvider(new ComscoreProvider());
OmnibugProvider.addProvider(new CrazyEggProvider());
OmnibugProvider.addProvider(new CriteoOneTagProvider());
OmnibugProvider.addProvider(new DemandbaseEngagementProvider());
OmnibugProvider.addProvider(new DynamicYieldProvider());
OmnibugProvider.addProvider(new EnsightenManageProvider());
OmnibugProvider.addProvider(new EnsightenServerSideProvider());
OmnibugProvider.addProvider(new FacebookPixelProvider());
OmnibugProvider.addProvider(new FullStoryProvider());
OmnibugProvider.addProvider(new GlassboxProvider());
OmnibugProvider.addProvider(new GoogleAdsProvider());
OmnibugProvider.addProvider(new GoogleAnalyticsProvider());
OmnibugProvider.addProvider(new GoogleAnalytics4Provider());
OmnibugProvider.addProvider(new GoogleDoubleClickProvider());
OmnibugProvider.addProvider(new GoogleTagManagerProvider());
OmnibugProvider.addProvider(new HotjarProvider());
OmnibugProvider.addProvider(new HubspotProvider());
OmnibugProvider.addProvider(new IndicativeProvider());
OmnibugProvider.addProvider(new InvocaProvider());
OmnibugProvider.addProvider(new LinkedInProvider());
OmnibugProvider.addProvider(new LyticsProvider());
OmnibugProvider.addProvider(new MatomoProvider());
OmnibugProvider.addProvider(new MedalliaDXAProvider());
OmnibugProvider.addProvider(new MerkleMerkuryProvider());
OmnibugProvider.addProvider(new MicrosoftClarityProvider());
OmnibugProvider.addProvider(new MixpanelProvider());
OmnibugProvider.addProvider(new MparticleProvider());
OmnibugProvider.addProvider(new OmniconvertProvider());
OmnibugProvider.addProvider(new OptimizelyXProvider());
OmnibugProvider.addProvider(new OutbrainProvider());
OmnibugProvider.addProvider(new ParselyProvider());
OmnibugProvider.addProvider(new PinterestProvider());
OmnibugProvider.addProvider(new PiwikPROProvider());
OmnibugProvider.addProvider(new PiwikPROTagManagerProvider());
OmnibugProvider.addProvider(new RedditPixelProvider());
OmnibugProvider.addProvider(new RTBHouseProvider());
OmnibugProvider.addProvider(new RudderStackProvider());
OmnibugProvider.addProvider(new SegmentProvider());
OmnibugProvider.addProvider(new SeznamSklikProvider());
OmnibugProvider.addProvider(new SixSenseProvider());
OmnibugProvider.addProvider(new SnapchatProvider());
OmnibugProvider.addProvider(new SojernProvider());
OmnibugProvider.addProvider(new SplitIOProvider());
OmnibugProvider.addProvider(new SpotifyPixelProvider());
OmnibugProvider.addProvider(new TeadsProvider());
OmnibugProvider.addProvider(new TealiumEventStreamProvider());
OmnibugProvider.addProvider(new TealiumIQProvider());
OmnibugProvider.addProvider(new TheTradeDeskUniversalProvider());
OmnibugProvider.addProvider(new TikTokProvider());
OmnibugProvider.addProvider(new TwitterProvider());
OmnibugProvider.addProvider(new VibesProvider());
OmnibugProvider.addProvider(new WebtrendsOnDemandProvider());
OmnibugProvider.addProvider(new ZemantaProvider());