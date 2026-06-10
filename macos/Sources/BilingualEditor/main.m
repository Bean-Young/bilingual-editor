#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
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

  [self loadEditor];
  [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return YES;
}

- (void)loadEditor {
  NSURL *resourceURL = [[NSBundle mainBundle] resourceURL];
  NSURL *webRoot = [resourceURL URLByAppendingPathComponent:@"Web" isDirectory:YES];
  NSURL *indexURL = [webRoot URLByAppendingPathComponent:@"index.html"];

  if (![[NSFileManager defaultManager] fileExistsAtPath:indexURL.path]) {
    [self showError:[NSString stringWithFormat:@"Could not find bundled editor at %@.", indexURL.path]];
    return;
  }

  [self.webView loadFileURL:indexURL allowingReadAccessToURL:webRoot];
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
