#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSURL *webRoot;
@property(nonatomic, assign) int serverSocket;
@property(nonatomic, assign) UInt16 serverPort;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];

  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.defaultWebpagePreferences.allowsContentJavaScript = YES;
  configuration.preferences.javaScriptCanOpenWindowsAutomatically = YES;
  configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];

  self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
  self.webView.navigationDelegate = self;

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
    [self loadEditor];
  }
  [NSApp activateIgnoringOtherApps:YES];
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

    NSString *request = [[NSString alloc] initWithBytes:buffer length:(NSUInteger)count encoding:NSUTF8StringEncoding];
    NSString *firstLine = [[request componentsSeparatedByString:@"\r\n"] firstObject] ?: @"";
    NSArray<NSString *> *parts = [firstLine componentsSeparatedByString:@" "];
    if (parts.count < 2 || !([parts[0] isEqualToString:@"GET"] || [parts[0] isEqualToString:@"HEAD"])) {
      [self sendStatus:405 body:@"Method Not Allowed" toClient:client];
      close(client);
      return;
    }

    BOOL headOnly = [parts[0] isEqualToString:@"HEAD"];
    NSString *path = parts[1];
    NSRange queryRange = [path rangeOfString:@"?"];
    if (queryRange.location != NSNotFound) {
      path = [path substringToIndex:queryRange.location];
    }
    path = [path stringByRemovingPercentEncoding] ?: @"/";
    if ([path isEqualToString:@"/"]) {
      path = @"/index.html";
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
