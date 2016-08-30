﻿/// <reference path="..\TestFramework\Common.ts" />
/// <reference path="../../javascriptsdk/sender.ts" />
/// <reference path="../../javascriptsdk/appinsights.ts" />

class SnippetTests extends TestClass {
    private aiName = "appInsights";
    private instrumentationKey = "3e6a441c-b52b-4f39-8944-f81dd6c2dc46";
    private originalAppInsights;
    private queueSpy;
    private queueCallCount = 100;

    private loadSnippet(path) {
        // load ai via the snippet
        window[this.aiName] = undefined;
        var key = "E2ETests";
        var snippetPath = window.location.href.split(key)[0] + key + path;
        var scriptElement = document.createElement("script");
        scriptElement.src = snippetPath;
        scriptElement.id = "testSnippet";
        document.getElementsByTagName("script")[0].parentNode.appendChild(scriptElement);
    }

    /** Method called before the start of each test method */
    public testInitialize() {
        var timingEnabled = typeof window != "undefined" && window.performance && window.performance.timing;

        this.originalAppInsights = window[this.aiName];
        window[this.aiName] = undefined;
        try {
            delete window[this.aiName];
        } catch (e) {
        }

        window['queueTest'] = () => null;
        this.queueSpy = this.sandbox.spy(window, "queueTest");
        this.useFakeTimers = false;
        this.clock.restore();
        this.useFakeServer = false;
        sinon.fakeServer["restore"]();
    }

    /** Method called after each test method has completed */
    public testCleanup() {
        this.useFakeServer = true;
        this.useFakeTimers = true;
        window[this.aiName] = this.originalAppInsights;
    }

    public registerTests() {
        var snippet_Latest = "/snippetLatest.js";

        // snippet version 1.0
        var snippet_10 = "/snippet10.js";

        // old snippet, before snippet versioning was implemented
        var snippet_01 = "/snippet01.js";

        this.testSnippet(snippet_Latest);
        this.testSnippet(snippet_10);
        this.testSnippet(snippet_01);

        var senderSpy71V2;
        this.testCaseAsync({
            name: "SnippetTests: API version 0.10 and lower can send (url,prop,meas) and the url is set correctly",
            stepDelay: 250,
            steps: [
                () => {
                    this.loadSnippet(snippet_01);
                },
                () => {
                    senderSpy71V2 = this.setAppInsights();

                    window["appInsights"].trackPageView("test", { property: "p1" }, { measurement: 5 });
                },
                () => {
                    Assert.equal(this.queueCallCount, this.queueSpy.callCount, "queue is emptied");
                    Assert.equal(2, senderSpy71V2.sender.callCount, "v2 send called " + 2 + " times");
                    this.boilerPlateAsserts(senderSpy71V2);

                    // check url and properties
                    var pv = <Microsoft.ApplicationInsights.Telemetry.PageView>senderSpy71V2.sender.args[0][0].data.baseData;
                    Assert.deepEqual("test", pv.url, "url was set correctly");
                    Assert.deepEqual({ property: "p1" }, pv.properties, "properties were set correctly");
                    Assert.deepEqual({ measurement: 5 }, pv.measurements, "measurements were set correctly");
                }
            ]
        });

        var sendSpy;
        this.testCaseAsync({
            name: "SnippetTests: SDK and Snippet versions are handled correctly",
            stepDelay: 250,
            steps: [
                () => {
                    this.loadSnippet(snippet_Latest);
                },
                () => {
                    sendSpy = this.setAppInsights();

                    window["appInsights"].trackPageView("test", { property: "p1" }, { measurement: 5 });
                },
                () => {
                    Assert.equal(this.queueCallCount, this.queueSpy.callCount, "queue is emptied");
                    Assert.equal(1, sendSpy.sender.callCount, "v2 send called");
                    this.boilerPlateAsserts(sendSpy);

                    // check url and properties
                    var expectedSdk = "javascript:" + Microsoft.ApplicationInsights.Version;
                    var expectedSnippet = "snippet:" + Microsoft.ApplicationInsights.SnippetVersion;

                    var data = <Microsoft.ApplicationInsights.Telemetry.Common.Envelope>sendSpy.sender.args[0][0];
                    Assert.equal(expectedSnippet, data.tags["ai.internal.agentVersion"], "snippet version was set correctly");
                    Assert.equal(expectedSdk, data.tags["ai.internal.sdkVersion"], "sdk version was set correctly");
                }
            ]
        });
    }

    private testSnippet(snippetPath) {
        var delay = 250;

        this.testCaseAsync({
            name: "SnippetTests: " + snippetPath + " is loaded",
            stepDelay: 50,
            steps: [
                () => {
                    this.loadSnippet(snippetPath);
                },
                () => {
                    Assert.ok(window[this.aiName], this.aiName + " is loaded");
                }
            ]
        });

        this.testCaseAsync({
            name: "SnippetTests: " + snippetPath + " drains the queue",
            stepDelay: 250,
            steps: [
                () => {
                    this.loadSnippet(snippetPath);
                },
                () => {
                    Assert.equal(this.queueCallCount, this.queueSpy.callCount, "queue is emptied");
                }
            ]
        });

        this.testCaseAsync({
            name: "SnippetTests: " + snippetPath + " configuration is read dynamically",
            stepDelay: delay,
            steps: [
                () => {
                    this.loadSnippet(snippetPath);
                },
                this.checkConfig
            ]
        });

        var sender;
        this.testCaseAsync({
            name: "SnippetTests: " + snippetPath + " can send to v2 endpoint with V2 API",
            stepDelay: delay,
            steps: [
                () => {
                    this.loadSnippet(snippetPath);
                },
                () => {
                    sender = this.setAppInsights();
                    window[this.aiName].trackEvent("test");
                    window[this.aiName].trackException(new Error("oh no!"));
                    window[this.aiName].trackMetric("test", Math.round(100 * Math.random()));
                    window[this.aiName].trackTrace("test");
                    window[this.aiName].trackPageView("test page");
                }]
                .concat(<any>PollingAssert.createPollingAssert(() => {
                    Assert.ok(true, "waiting for response " + new Date().toISOString());
                    return (sender.successSpy.called || sender.errorSpy.called);
                }, "Wait for response", 5, 1000))
                .concat(() => {
                    Assert.equal(this.queueCallCount, this.queueSpy.callCount, "queue is emptied");
                    Assert.equal(5, sender.sender.callCount, "send called 5 times");
                    this.boilerPlateAsserts(sender);
                })
        });
    }

    private checkConfig() {
        var initial = window[this.aiName];
        var test = (expected, memberName, readFunction) => {
            var appIn = <Microsoft.ApplicationInsights.AppInsights>window[this.aiName];
            appIn.config[memberName] = expected;
            var actual = readFunction();
            Assert.equal(expected, actual, memberName + ": value is read dynamically");
        };

        var testSenderValues = (expected, memberName) => {
            var appIn = <Microsoft.ApplicationInsights.AppInsights>window[this.aiName];
            test(expected, memberName, appIn.context._sender._config[memberName]);
        };

        var testContextValues = (expected, memberName) => {
            var appIn = <Microsoft.ApplicationInsights.AppInsights>window[this.aiName];
            test(expected, memberName, appIn.context._config[memberName]);
        };

        // sender values
        testSenderValues(10, "maxBatchInterval");
        testSenderValues(10, "maxBatchSizeInBytes");
        testSenderValues(10, "endpointUrl");
        testSenderValues(false, "disableTelemetry");

        // context values
        testContextValues("instrumentationKey", "instrumentationKey");
        testContextValues("accountId", "accountId");

        // logging
        test(true, "enableDebug", Microsoft.ApplicationInsights._InternalLogging.enableDebugExceptions);
    }

    private setAppInsights() {
        window["appInsights"].endpointUrl = "https://dc.services.visualstudio.com/v2/track";
        window["appInsights"].maxBatchInterval = 1;
        var appIn = <Microsoft.ApplicationInsights.AppInsights>window[this.aiName];
        var sender = this.sandbox.spy(appIn.context._sender, "send");
        var errorSpy = this.sandbox.spy(appIn.context._sender, "_onError");
        var successSpy = this.sandbox.spy(appIn.context._sender, "_onSuccess");
        var loggingSpy = this.sandbox.spy(Microsoft.ApplicationInsights._InternalLogging, "throwInternalUserActionable");

        return {
            sender: sender,
            errorSpy: errorSpy,
            successSpy: successSpy,
            loggingSpy: loggingSpy,
            restore: () => {
            }
        };
    }

    private boilerPlateAsserts(spies) {
        Assert.ok(spies.successSpy.called, "success handler was called");
        Assert.ok(!spies.errorSpy.called, "no error sending");
        var isValidCallCount = spies.loggingSpy.callCount === 0;
        Assert.ok(isValidCallCount, "logging spy was called 0 time(s)");
        if (!isValidCallCount) {
            while (spies.loggingSpy.args.length) {
                Assert.ok(false, "[warning thrown]: " + spies.loggingSpy.args.pop());
            }
        }
    }
}

new SnippetTests().registerTests();