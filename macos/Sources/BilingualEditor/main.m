#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSURL *webRoot;
@property(nonatomic, assign) int serverSocket;
@property(nonatomic, assign) UInt16 serverPort;
- (void)sendJsonStatus:(int)status body:(NSDictionary *)body toClient:(int)client;
- (void)sendOptionsResponseToClient:(int)client;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  [self installApplicationMenu];

  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.defaultWebpagePreferences.allowsContentJavaScript = YES;
  configuration.preferences.javaScriptCanOpenWindowsAutomatically = YES;
  configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];

  self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
  self.webView.navigationDelegate = self;
  self.webView.UIDelegate = self;

  NSRect frame = NSMakeRect(0, 0, 1320, 860);
  NSWindowStyleMask styleMask = NSWindowStyleMaskTitled |
    NSWindowStyleMaskClosable |
    NSWindowStyleMaskMiniaturizable |
    NSWindowStyleMaskResizable;

  self.window = [[NSWindow alloc] initWithContentRect:frame
                                            styleMask:styleMask
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
  self.window.title = @"Bilingual Editor";
  self.window.minSize = NSMakeSize(1040, 680);
  self.window.contentView = self.webView;
  [self.window center];
  [self.window makeKeyAndOrderFront:nil];

  if ([self startLocalWebServer]) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self loadEditor];
    });
  }
  [NSApp activateIgnoringOtherApps:YES];
}

- (void)installApplicationMenu {
  NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];

  NSMenuItem *appMenuItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
  [mainMenu addItem:appMenuItem];
  NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Bilingual Editor"];
  [appMenu addItemWithTitle:@"Quit Bilingual Editor" action:@selector(terminate:) keyEquivalent:@"q"];
  appMenuItem.submenu = appMenu;

  NSMenuItem *editMenuItem = [[NSMenuItem alloc] initWithTitle:@"Edit" action:nil keyEquivalent:@""];
  [mainMenu addItem:editMenuItem];
  NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
  [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
  NSMenuItem *redoItem = [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
  redoItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
  [editMenu addItem:[NSMenuItem separatorItem]];
  [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  [editMenu addItemWithTitle:@"Delete" action:@selector(delete:) keyEquivalent:@""];
  [editMenu addItem:[NSMenuItem separatorItem]];
  [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  editMenuItem.submenu = editMenu;

  NSApp.mainMenu = mainMenu;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  if (self.serverSocket > 0) {
    close(self.serverSocket);
    self.serverSocket = -1;
  }
}

- (void)loadEditor {
  NSString *urlString = [NSString stringWithFormat:@"http://127.0.0.1:%hu/index.html", self.serverPort];
  NSURL *indexURL = [NSURL URLWithString:urlString];
  NSLog(@"Bilingual Editor loading %@", urlString);
  [self.webView loadRequest:[NSURLRequest requestWithURL:indexURL]];
}

- (BOOL)startLocalWebServer {
  NSURL *resourceURL = [[NSBundle mainBundle] resourceURL];
  self.webRoot = [resourceURL URLByAppendingPathComponent:@"Web" isDirectory:YES];
  NSURL *indexURL = [self.webRoot URLByAppendingPathComponent:@"index.html"];

  if (![[NSFileManager defaultManager] fileExistsAtPath:indexURL.path]) {
    [self showError:[NSString stringWithFormat:@"Could not find bundled editor at %@.", indexURL.path]];
    return NO;
  }

  int socketFD = socket(AF_INET, SOCK_STREAM, 0);
  if (socketFD < 0) {
    [self showError:@"Could not create the local web server socket."];
    return NO;
  }

  int yes = 1;
  setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = 0;

  if (bind(socketFD, (struct sockaddr *)&address, sizeof(address)) < 0) {
    close(socketFD);
    [self showError:@"Could not bind the local web server to 127.0.0.1."];
    return NO;
  }

  socklen_t addressLength = sizeof(address);
  if (getsockname(socketFD, (struct sockaddr *)&address, &addressLength) < 0) {
    close(socketFD);
    [self showError:@"Could not read the local web server port."];
    return NO;
  }

  if (listen(socketFD, 16) < 0) {
    close(socketFD);
    [self showError:@"Could not start the local web server."];
    return NO;
  }

  self.serverSocket = socketFD;
  self.serverPort = ntohs(address.sin_port);
  NSLog(@"Bilingual Editor serving %@ at http://127.0.0.1:%hu/index.html", self.webRoot.path, self.serverPort);

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [self acceptLocalConnections];
  });

  return YES;
}

- (void)acceptLocalConnections {
  while (self.serverSocket > 0) {
    int client = accept(self.serverSocket, NULL, NULL);
    if (client < 0) {
      continue;
    }

    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      [self handleClient:client];
    });
  }
}

- (void)handleClient:(int)client {
  @autoreleasepool {
    char buffer[8192];
    ssize_t count = recv(client, buffer, sizeof(buffer) - 1, 0);
    if (count <= 0) {
      close(client);
      return;
    }
    buffer[count] = '\0';

    NSMutableData *requestData = [NSMutableData dataWithBytes:buffer length:(NSUInteger)count];
    NSString *request = [[NSString alloc] initWithData:requestData encoding:NSUTF8StringEncoding] ?: @"";
    NSInteger contentLength = [self contentLengthFromRequest:request];
    NSRange headerRange = [request rangeOfString:@"\r\n\r\n"];
    while (headerRange.location != NSNotFound && contentLength > 0) {
      NSUInteger bodyStart = headerRange.location + headerRange.length;
      if (requestData.length >= bodyStart + (NSUInteger)contentLength) {
        break;
      }
      ssize_t more = recv(client, buffer, sizeof(buffer), 0);
      if (more <= 0) break;
      [requestData appendBytes:buffer length:(NSUInteger)more];
      request = [[NSString alloc] initWithData:requestData encoding:NSUTF8StringEncoding] ?: @"";
      headerRange = [request rangeOfString:@"\r\n\r\n"];
    }

    NSString *firstLine = [[request componentsSeparatedByString:@"\r\n"] firstObject] ?: @"";
    NSArray<NSString *> *parts = [firstLine componentsSeparatedByString:@" "];
    if (parts.count < 2) {
      [self sendStatus:405 body:@"Method Not Allowed" toClient:client];
      close(client);
      return;
    }

    NSString *method = parts[0];
    BOOL headOnly = [method isEqualToString:@"HEAD"];
    NSString *path = parts[1];
    NSRange queryRange = [path rangeOfString:@"?"];
    if (queryRange.location != NSNotFound) {
      path = [path substringToIndex:queryRange.location];
    }
    path = [path stringByRemovingPercentEncoding] ?: @"/";
    if ([path isEqualToString:@"/"]) {
      path = @"/index.html";
    }

    if ([method isEqualToString:@"OPTIONS"] && [path isEqualToString:@"/api/translate"]) {
      [self sendOptionsResponseToClient:client];
      close(client);
      return;
    }

    if ([method isEqualToString:@"POST"] && [path isEqualToString:@"/api/translate"]) {
      if (headerRange.location == NSNotFound) {
        [self sendJsonStatus:400 body:@{@"error": @"invalid translate request"} toClient:client];
        close(client);
        return;
      }
      NSUInteger bodyStart = headerRange.location + headerRange.length;
      NSData *bodyData = bodyStart <= requestData.length ? [requestData subdataWithRange:NSMakeRange(bodyStart, requestData.length - bodyStart)] : [NSData data];
      [self handleTranslateApiRequestBody:bodyData toClient:client];
      close(client);
      return;
    }

    if (!([method isEqualToString:@"GET"] || [method isEqualToString:@"HEAD"])) {
      [self sendStatus:405 body:@"Method Not Allowed" toClient:client];
      close(client);
      return;
    }

    NSString *relative = [[path stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/"]] stringByStandardizingPath];
    if ([relative hasPrefix:@".."] || [relative containsString:@"/../"]) {
      [self sendStatus:403 body:@"Forbidden" toClient:client];
      close(client);
      return;
    }

    NSURL *fileURL = [self.webRoot URLByAppendingPathComponent:relative isDirectory:NO];
    NSString *webRootPath = [self.webRoot.path stringByStandardizingPath];
    NSString *filePath = [fileURL.path stringByStandardizingPath];
    if (![filePath hasPrefix:webRootPath]) {
      [self sendStatus:403 body:@"Forbidden" toClient:client];
      close(client);
      return;
    }

    NSData *data = [NSData dataWithContentsOfFile:filePath];
    if (!data) {
      NSLog(@"Bilingual Editor local server missing file: %@", filePath);
      [self sendStatus:404 body:@"Not Found" toClient:client];
      close(client);
      return;
    }

    NSString *mimeType = [self mimeTypeForPath:filePath];
    NSMutableString *headers = [NSMutableString stringWithFormat:
      @"HTTP/1.1 200 OK\r\n"
      "Content-Type: %@\r\n"
      "Content-Length: %lu\r\n"
      "Cache-Control: no-store\r\n"
      "Connection: close\r\n\r\n",
      mimeType,
      (unsigned long)data.length
    ];
    [self sendString:headers toClient:client];
    if (!headOnly) {
      send(client, data.bytes, data.length, 0);
    }
    close(client);
  }
}

- (NSInteger)contentLengthFromRequest:(NSString *)request {
  NSArray<NSString *> *lines = [request componentsSeparatedByString:@"\r\n"];
  for (NSString *line in lines) {
    NSRange range = [line rangeOfString:@"Content-Length:" options:NSCaseInsensitiveSearch];
    if (range.location == 0) {
      NSString *value = [[line substringFromIndex:range.length] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      return value.integerValue;
    }
  }
  return 0;
}

- (void)handleTranslateApiRequestBody:(NSData *)bodyData toClient:(int)client {
  NSError *jsonError = nil;
  NSDictionary *body = [NSJSONSerialization JSONObjectWithData:bodyData options:0 error:&jsonError];
  if (![body isKindOfClass:NSDictionary.class]) {
    [self sendJsonStatus:400 body:@{@"error": @"invalid translate request JSON"} toClient:client];
    return;
  }

  NSArray *chunks = [body[@"chunks"] isKindOfClass:NSArray.class] ? body[@"chunks"] : nil;
  if (!chunks.count) {
    [self sendJsonStatus:400 body:@{@"error": @"chunks must be a non-empty array"} toClient:client];
    return;
  }

  NSDictionary *provider = [self providerConfigFromBody:body];
  NSString *apiKey = provider[@"apiKey"] ?: @"";
  NSString *label = provider[@"label"] ?: @"Translation provider";
  if (!apiKey.length) {
    [self sendJsonStatus:400 body:@{@"error": [NSString stringWithFormat:@"missing %@ API key", label]} toClient:client];
    return;
  }
  if (![self isAsciiHeaderValue:apiKey]) {
    [self sendJsonStatus:400 body:@{@"error": [NSString stringWithFormat:@"%@ API Key 格式不正确：请只粘贴 key 本身，不要包含中文说明、整段代码或其他非英文字符", label]} toClient:client];
    return;
  }

  NSString *mode = [body[@"mode"] isKindOfClass:NSString.class] ? body[@"mode"] : @"import";
  BOOL bilingualSync = [mode isEqualToString:@"bilingual-sync"];
  NSDictionary *payload = [self chatPayloadForTranslateBody:body provider:provider];
  NSDictionary *result = [self callChatCompletionsURL:provider[@"url"] apiKey:apiKey payload:payload];
  NSInteger status = [result[@"status"] integerValue];
  NSDictionary *upstream = [result[@"json"] isKindOfClass:NSDictionary.class] ? result[@"json"] : @{};

  if (status == 400 && [self responseFormatRejected:upstream]) {
    NSMutableDictionary *retryPayload = [payload mutableCopy];
    [retryPayload removeObjectForKey:@"response_format"];
    result = [self callChatCompletionsURL:provider[@"url"] apiKey:apiKey payload:retryPayload];
    status = [result[@"status"] integerValue];
    upstream = [result[@"json"] isKindOfClass:NSDictionary.class] ? result[@"json"] : @{};
  }

  if (status < 200 || status >= 300) {
    NSString *message = [self upstreamErrorMessage:upstream fallback:@"request failed"];
    [self sendJsonStatus:status ?: 400 body:@{@"error": [NSString stringWithFormat:@"%@ %ld %@", label, (long)status, message]} toClient:client];
    return;
  }

  NSString *content = [self chatCompletionContent:upstream];
  id parsed = [self extractJsonValueFromString:content];
  NSArray *translations = [self normalizeTranslations:parsed expectedLength:chunks.count];
  if (!translations) {
    [self sendJsonStatus:400 body:@{@"error": [NSString stringWithFormat:@"model returned an invalid translations array (%@)", [self describeJsonShape:parsed]]} toClient:client];
    return;
  }

  NSMutableDictionary *response = [@{@"translations": translations, @"usage": upstream[@"usage"] ?: [NSNull null]} mutableCopy];
  if (bilingualSync) {
    NSArray *sources = [self normalizeSources:parsed expectedLength:chunks.count];
    if (!sources) {
      [self sendJsonStatus:400 body:@{@"error": [NSString stringWithFormat:@"model returned an invalid sources array (%@)", [self describeJsonShape:parsed]]} toClient:client];
      return;
    }
    response[@"sources"] = sources;
  }
  [self sendJsonStatus:200 body:response toClient:client];
}

- (NSDictionary *)providerConfigFromBody:(NSDictionary *)body {
  NSString *provider = [body[@"provider"] isKindOfClass:NSString.class] ? body[@"provider"] : @"nvidia";
  NSString *baseUrl = [body[@"baseUrl"] isKindOfClass:NSString.class] ? [body[@"baseUrl"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : @"";
  NSString *model = [body[@"model"] isKindOfClass:NSString.class] ? [body[@"model"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : @"";
  NSString *apiKey = [self normalizeApiKey:body[@"apiKey"]];

  if ([provider isEqualToString:@"deepseek"]) {
    return @{
      @"label": @"DeepSeek",
      @"apiKey": apiKey,
      @"url": baseUrl.length ? baseUrl : @"https://api.deepseek.com/v1/chat/completions",
      @"model": model.length ? model : @"deepseek-chat",
    };
  }
  if ([provider isEqualToString:@"custom"]) {
    return @{
      @"label": @"Custom",
      @"apiKey": apiKey,
      @"url": baseUrl,
      @"model": model,
    };
  }
  return @{
    @"label": @"NVIDIA",
    @"apiKey": apiKey,
    @"url": baseUrl.length ? baseUrl : @"https://integrate.api.nvidia.com/v1/chat/completions",
    @"model": model.length ? model : @"moonshotai/kimi-k2.6",
  };
}

- (NSString *)normalizeApiKey:(id)value {
  NSString *key = [value isKindOfClass:NSString.class] ? value : @"";
  key = [key stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  key = [key stringByReplacingOccurrencesOfString:@"^Authorization:\\s*" withString:@"" options:NSRegularExpressionSearch range:NSMakeRange(0, key.length)];
  key = [key stringByReplacingOccurrencesOfString:@"^Bearer\\s+" withString:@"" options:NSRegularExpressionSearch | NSCaseInsensitiveSearch range:NSMakeRange(0, key.length)];
  key = [key stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"\"'"]];
  key = [key stringByReplacingOccurrencesOfString:@"\\s+" withString:@"" options:NSRegularExpressionSearch range:NSMakeRange(0, key.length)];
  return key;
}

- (BOOL)isAsciiHeaderValue:(NSString *)value {
  for (NSUInteger index = 0; index < value.length; index += 1) {
    unichar character = [value characterAtIndex:index];
    if (character < 0x21 || character > 0x7E) return NO;
  }
  return YES;
}

- (NSDictionary *)chatPayloadForTranslateBody:(NSDictionary *)body provider:(NSDictionary *)provider {
  NSArray *chunks = [body[@"chunks"] isKindOfClass:NSArray.class] ? body[@"chunks"] : @[];
  NSString *mode = [body[@"mode"] isKindOfClass:NSString.class] ? body[@"mode"] : @"import";
  NSString *sourceLang = [body[@"sourceLang"] isKindOfClass:NSString.class] ? body[@"sourceLang"] : @"auto";
  NSString *targetLang = [body[@"targetLang"] isKindOfClass:NSString.class] ? body[@"targetLang"] : @"auto";
  NSString *format = [body[@"format"] isKindOfClass:NSString.class] ? body[@"format"] : @"plain text";
  NSArray *references = [body[@"referenceTranslations"] isKindOfClass:NSArray.class] ? body[@"referenceTranslations"] : nil;
  NSArray *originals = [body[@"originalChunks"] isKindOfClass:NSArray.class] ? body[@"originalChunks"] : nil;
  NSArray *changes = [body[@"changeSummaries"] isKindOfClass:NSArray.class] ? body[@"changeSummaries"] : nil;
  NSArray *suggestions = [body[@"reviewSuggestions"] isKindOfClass:NSArray.class] ? body[@"reviewSuggestions"] : nil;
  NSArray *insertions = [body[@"paragraphInsertions"] isKindOfClass:NSArray.class] ? body[@"paragraphInsertions"] : nil;

  NSMutableArray *items = [NSMutableArray array];
  for (NSUInteger index = 0; index < chunks.count; index += 1) {
    [items addObject:@{
      @"originalSource": originals && index < originals.count ? originals[index] : [NSNull null],
      @"editedSource": chunks[index],
      @"editSummary": changes && index < changes.count ? changes[index] : [NSNull null],
      @"previousTarget": references && index < references.count ? references[index] : [NSNull null],
      @"isParagraphInsertion": insertions && index < insertions.count ? insertions[index] : @NO,
      @"reviewSuggestions": suggestions && index < suggestions.count ? suggestions[index] : [NSNull null],
    }];
  }

  NSData *itemsData = [NSJSONSerialization dataWithJSONObject:items options:0 error:nil];
  NSString *itemsJson = [[NSString alloc] initWithData:itemsData encoding:NSUTF8StringEncoding] ?: @"[]";
  NSString *task = [mode isEqualToString:@"bilingual-sync"] ? @"repair source grammar and update target translation in one pass" : @"initial document translation";
  if ([mode isEqualToString:@"refine"]) task = @"refine an edited passage";
  if ([mode isEqualToString:@"review-source"]) task = @"revise the source passage using review suggestions";
  if ([mode isEqualToString:@"comment"]) task = @"translate selected comment text";
  if ([mode isEqualToString:@"patch"]) task = @"translate inserted fragments";

  NSString *userPrompt = [NSString stringWithFormat:
    @"Task: %@.\nSource language: %@.\nTarget language: %@.\nDocument format: %@.\n"
    "Return valid JSON only. Ordinary modes must return {\"translations\":[\"...\"]}. "
    "bilingual-sync must return {\"sources\":[\"...\"],\"translations\":[\"...\"]}. "
    "The top-level JSON value must be an object, not a bare array. Do not use Chinese field names.\n"
    "Input JSON:\n%@",
    task,
    [self languageName:sourceLang],
    [self languageName:targetLang],
    format,
    itemsJson
  ];

  return @{
    @"model": provider[@"model"] ?: @"",
    @"messages": @[
      @{@"role": @"system", @"content": [self translationSystemPrompt]},
      @{@"role": @"user", @"content": userPrompt},
    ],
    @"max_tokens": @16384,
    @"temperature": @0.1,
    @"top_p": @1,
    @"stream": @NO,
    @"response_format": @{@"type": @"json_object"},
  };
}

- (NSString *)translationSystemPrompt {
  return @"You are a bilingual document translation engine for an Overleaf-like editor. Translate directly and faithfully. Preserve LaTeX, Markdown, HTML, code, math, citations, labels, refs, URLs, identifiers, document structure, and formatting. For refinement, update previous target text with the smallest necessary edit. For review-source, only minimally repair grammar in the edited source language. For bilingual-sync, return minimally repaired source text and the corresponding target translation. Return only valid JSON with the exact requested keys and array lengths.";
}

- (NSString *)languageName:(NSString *)code {
  NSDictionary *names = @{@"auto": @"auto detected", @"zh-CN": @"Chinese Simplified", @"zh-TW": @"Chinese Traditional", @"en": @"English", @"ja": @"Japanese", @"de": @"German", @"fr": @"French", @"es": @"Spanish", @"ar": @"Arabic"};
  return names[code] ?: code ?: @"auto detected";
}

- (NSDictionary *)callChatCompletionsURL:(NSString *)urlString apiKey:(NSString *)apiKey payload:(NSDictionary *)payload {
  NSURL *url = [NSURL URLWithString:urlString ?: @""];
  if (!url) return @{@"status": @400, @"json": @{@"error": @"invalid API URL"}};
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:180];
  request.HTTPMethod = @"POST";
  [request setValue:[NSString stringWithFormat:@"Bearer %@", apiKey] forHTTPHeaderField:@"Authorization"];
  [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];

  __block NSData *responseData = nil;
  __block NSURLResponse *response = nil;
  __block NSError *requestError = nil;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  NSURLSessionDataTask *task = [NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *res, NSError *error) {
    responseData = data;
    response = res;
    requestError = error;
    dispatch_semaphore_signal(semaphore);
  }];
  [task resume];
  dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(190 * NSEC_PER_SEC)));

  if (requestError) {
    return @{@"status": @400, @"json": @{@"error": requestError.localizedDescription ?: @"request failed"}};
  }
  NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 0;
  id json = responseData ? [NSJSONSerialization JSONObjectWithData:responseData options:0 error:nil] : nil;
  return @{@"status": @(status), @"json": [json isKindOfClass:NSDictionary.class] ? json : @{}};
}

- (BOOL)responseFormatRejected:(NSDictionary *)json {
  NSString *message = [[self upstreamErrorMessage:json fallback:@""] lowercaseString];
  return [message containsString:@"response_format"] || [message containsString:@"json_object"];
}

- (NSString *)upstreamErrorMessage:(NSDictionary *)json fallback:(NSString *)fallback {
  id error = json[@"error"];
  if ([error isKindOfClass:NSDictionary.class] && [error[@"message"] isKindOfClass:NSString.class]) return error[@"message"];
  if ([error isKindOfClass:NSString.class]) return error;
  if ([json[@"message"] isKindOfClass:NSString.class]) return json[@"message"];
  return fallback;
}

- (NSString *)chatCompletionContent:(NSDictionary *)json {
  NSArray *choices = [json[@"choices"] isKindOfClass:NSArray.class] ? json[@"choices"] : @[];
  NSDictionary *choice = choices.firstObject;
  NSDictionary *message = [choice isKindOfClass:NSDictionary.class] && [choice[@"message"] isKindOfClass:NSDictionary.class] ? choice[@"message"] : nil;
  if ([message[@"content"] isKindOfClass:NSString.class]) return message[@"content"];
  return @"";
}

- (id)extractJsonValueFromString:(NSString *)content {
  NSString *text = [[content ?: @"" stringByReplacingOccurrencesOfString:@"^```(?:json)?\\s*" withString:@"" options:NSRegularExpressionSearch | NSCaseInsensitiveSearch range:NSMakeRange(0, (content ?: @"").length)] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  text = [text stringByReplacingOccurrencesOfString:@"\\s*```$" withString:@"" options:NSRegularExpressionSearch range:NSMakeRange(0, text.length)];
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (parsed) return parsed;
  NSRange objectStart = [text rangeOfString:@"{"];
  NSRange objectEnd = [text rangeOfString:@"}" options:NSBackwardsSearch];
  if (objectStart.location != NSNotFound && objectEnd.location != NSNotFound && objectEnd.location > objectStart.location) {
    NSString *slice = [text substringWithRange:NSMakeRange(objectStart.location, objectEnd.location - objectStart.location + 1)];
    parsed = [NSJSONSerialization JSONObjectWithData:[slice dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (parsed) return parsed;
  }
  NSRange arrayStart = [text rangeOfString:@"["];
  NSRange arrayEnd = [text rangeOfString:@"]" options:NSBackwardsSearch];
  if (arrayStart.location != NSNotFound && arrayEnd.location != NSNotFound && arrayEnd.location > arrayStart.location) {
    NSString *slice = [text substringWithRange:NSMakeRange(arrayStart.location, arrayEnd.location - arrayStart.location + 1)];
    parsed = [NSJSONSerialization JSONObjectWithData:[slice dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (parsed) return parsed;
  }
  return nil;
}

- (NSArray *)normalizeTranslations:(id)parsed expectedLength:(NSUInteger)expectedLength {
  if (expectedLength == 0) return @[];
  if ([parsed isKindOfClass:NSString.class] && expectedLength == 1) return @[parsed];
  if ([parsed isKindOfClass:NSArray.class]) return [self normalizeTranslationArray:parsed expectedLength:expectedLength source:NO];
  if (![parsed isKindOfClass:NSDictionary.class]) return nil;
  NSDictionary *dict = parsed;
  for (NSString *key in @[@"translations", @"translation", @"results", @"outputs", @"items", @"data"]) {
    id candidate = dict[key];
    if ([candidate isKindOfClass:NSString.class] && expectedLength == 1) return @[candidate];
    if ([candidate isKindOfClass:NSArray.class]) {
      NSArray *normalized = [self normalizeTranslationArray:candidate expectedLength:expectedLength source:NO];
      if (normalized) return normalized;
    }
  }
  NSMutableArray *numeric = [NSMutableArray array];
  for (NSUInteger index = 0; index < expectedLength; index += 1) {
    NSString *item = [self translationTextFromItem:dict[[NSString stringWithFormat:@"%lu", (unsigned long)index]] ?: dict[[NSString stringWithFormat:@"%lu", (unsigned long)(index + 1)]] source:NO];
    if (!item) { numeric = nil; break; }
    [numeric addObject:item];
  }
  if (numeric) return numeric;
  NSString *single = [self translationTextFromItem:dict source:NO];
  return single && expectedLength == 1 ? @[single] : nil;
}

- (NSArray *)normalizeSources:(id)parsed expectedLength:(NSUInteger)expectedLength {
  if (![parsed isKindOfClass:NSDictionary.class]) return nil;
  NSDictionary *dict = parsed;
  for (NSString *key in @[@"sources", @"revisedSources", @"sourceUpdates", @"editedSources", @"source"]) {
    id candidate = dict[key];
    if ([candidate isKindOfClass:NSArray.class]) {
      NSArray *normalized = [self normalizeTranslationArray:candidate expectedLength:expectedLength source:YES];
      if (normalized) return normalized;
    }
  }
  return nil;
}

- (NSArray *)normalizeTranslationArray:(NSArray *)array expectedLength:(NSUInteger)expectedLength source:(BOOL)source {
  if (array.count < expectedLength) return nil;
  NSMutableArray *result = [NSMutableArray array];
  for (NSUInteger index = 0; index < expectedLength; index += 1) {
    NSString *text = [self translationTextFromItem:array[index] source:source];
    if (!text) return nil;
    [result addObject:text];
  }
  return result;
}

- (NSString *)translationTextFromItem:(id)item source:(BOOL)source {
  if ([item isKindOfClass:NSString.class]) return item;
  if (item == nil || item == NSNull.null) return @"";
  if ([item isKindOfClass:NSArray.class]) {
    NSArray *array = item;
    return array.count == 1 ? [self translationTextFromItem:array.firstObject source:source] : nil;
  }
  if (![item isKindOfClass:NSDictionary.class]) return [item description];

  NSDictionary *dict = item;
  NSArray *keys = source
    ? @[@"source", @"revisedSource", @"editedSource", @"sourceText", @"input", @"text", @"content", @"原文", @"源文", @"修订原文"]
    : @[@"translation", @"translated", @"translatedText", @"translated_text", @"target", @"targetText", @"target_text", @"text", @"output", @"content", @"译文", @"翻译", @"翻译结果", @"结果"];
  for (NSString *key in keys) {
    id value = dict[key];
    if ([value isKindOfClass:NSString.class]) return value;
    if ([value isKindOfClass:NSArray.class] && [(NSArray *)value count] == 1) return [self translationTextFromItem:[(NSArray *)value firstObject] source:source];
  }
  NSMutableArray *stringValues = [NSMutableArray array];
  for (NSString *key in dict) {
    id value = dict[key];
    if (![value isKindOfClass:NSString.class]) continue;
    NSString *lower = key.lowercaseString;
    BOOL matches = source
      ? ([lower containsString:@"source"] || [lower containsString:@"input"] || [key containsString:@"原文"] || [key containsString:@"源文"])
      : ([lower containsString:@"translat"] || [lower containsString:@"target"] || [lower containsString:@"output"] || [lower containsString:@"result"] || [key containsString:@"译"] || [key containsString:@"翻译"] || [key containsString:@"结果"]);
    if (matches) return value;
    [stringValues addObject:value];
  }
  return stringValues.count == 1 ? stringValues.firstObject : nil;
}

- (NSString *)describeJsonShape:(id)value {
  if ([value isKindOfClass:NSArray.class]) return [NSString stringWithFormat:@"array(%lu)", (unsigned long)[(NSArray *)value count]];
  if ([value isKindOfClass:NSDictionary.class]) return [NSString stringWithFormat:@"object keys: %@", [[(NSDictionary *)value allKeys] componentsJoinedByString:@", "]];
  return value ? NSStringFromClass([value class]) : @"null";
}

- (NSString *)mimeTypeForPath:(NSString *)path {
  NSString *extension = path.pathExtension.lowercaseString;
  if ([extension isEqualToString:@"html"]) return @"text/html; charset=utf-8";
  if ([extension isEqualToString:@"js"]) return @"text/javascript; charset=utf-8";
  if ([extension isEqualToString:@"css"]) return @"text/css; charset=utf-8";
  if ([extension isEqualToString:@"json"]) return @"application/json; charset=utf-8";
  if ([extension isEqualToString:@"svg"]) return @"image/svg+xml";
  if ([extension isEqualToString:@"png"]) return @"image/png";
  if ([extension isEqualToString:@"jpg"] || [extension isEqualToString:@"jpeg"]) return @"image/jpeg";
  if ([extension isEqualToString:@"woff2"]) return @"font/woff2";
  return @"application/octet-stream";
}

- (void)sendStatus:(int)status body:(NSString *)body toClient:(int)client {
  NSString *reason = status == 403 ? @"Forbidden" : status == 404 ? @"Not Found" : status == 405 ? @"Method Not Allowed" : @"Error";
  NSData *data = [body dataUsingEncoding:NSUTF8StringEncoding];
  NSString *headers = [NSString stringWithFormat:
    @"HTTP/1.1 %d %@\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "Content-Length: %lu\r\n"
    "Connection: close\r\n\r\n",
    status,
    reason,
    (unsigned long)data.length
  ];
  [self sendString:headers toClient:client];
  send(client, data.bytes, data.length, 0);
}

- (void)sendJsonStatus:(int)status body:(NSDictionary *)body toClient:(int)client {
  NSData *data = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil] ?: [@"{}" dataUsingEncoding:NSUTF8StringEncoding];
  NSString *reason = status == 200 ? @"OK" : status == 204 ? @"No Content" : status == 400 ? @"Bad Request" : status == 405 ? @"Method Not Allowed" : @"Error";
  NSString *headers = [NSString stringWithFormat:
    @"HTTP/1.1 %d %@\r\n"
    "Content-Type: application/json; charset=utf-8\r\n"
    "Content-Length: %lu\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: POST, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type\r\n"
    "Connection: close\r\n\r\n",
    status,
    reason,
    (unsigned long)data.length
  ];
  [self sendString:headers toClient:client];
  send(client, data.bytes, data.length, 0);
}

- (void)sendOptionsResponseToClient:(int)client {
  NSString *headers =
    @"HTTP/1.1 204 No Content\r\n"
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: POST, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type\r\n"
    "Content-Length: 0\r\n"
    "Connection: close\r\n\r\n";
  [self sendString:headers toClient:client];
}

- (void)sendString:(NSString *)string toClient:(int)client {
  NSData *data = [string dataUsingEncoding:NSUTF8StringEncoding];
  send(client, data.bytes, data.length, 0);
}

- (void)showError:(NSString *)message {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Bilingual Editor could not start";
  alert.informativeText = message;
  alert.alertStyle = NSAlertStyleCritical;
  [alert runModal];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  [self showWebError:error];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  [self showWebError:error];
}

- (void)webView:(WKWebView *)webView
runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(NSArray<NSURL *> * _Nullable URLs))completionHandler {
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseFiles = YES;
  panel.canChooseDirectories = NO;
  panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
  panel.resolvesAliases = YES;
  panel.prompt = @"Upload";

  NSWindow *sheetWindow = self.window ?: NSApp.keyWindow;
  if (sheetWindow) {
    [panel beginSheetModalForWindow:sheetWindow completionHandler:^(NSModalResponse result) {
      completionHandler(result == NSModalResponseOK ? panel.URLs : nil);
    }];
    return;
  }

  NSModalResponse result = [panel runModal];
  completionHandler(result == NSModalResponseOK ? panel.URLs : nil);
}

- (void)showWebError:(NSError *)error {
  NSLog(@"Bilingual Editor web view failed: %@", error);
  NSString *escapedMessage = [[error localizedDescription] stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"];
  escapedMessage = [escapedMessage stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"];
  escapedMessage = [escapedMessage stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
  NSString *html = [NSString stringWithFormat:
    @"<!doctype html><meta charset=\"utf-8\"><style>"
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f7fb;color:#172033;margin:0;display:grid;place-items:center;height:100vh}"
    ".card{max-width:560px;background:white;border:1px solid #d9e1ee;border-radius:14px;padding:24px;box-shadow:0 16px 45px rgba(20,45,85,.12)}"
    "h1{font-size:20px;margin:0 0 10px}p{line-height:1.55;color:#526071}"
    "</style><div class=\"card\"><h1>Bilingual Editor could not load</h1><p>%@</p></div>",
    escapedMessage ?: @"Unknown loading error."
  ];
  [self.webView loadHTMLString:html baseURL:nil];
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    AppDelegate *delegate = [[AppDelegate alloc] init];
    app.delegate = delegate;
    [app run];
  }
  return 0;
}
