// Runs without elevated privileges. Keep the previous bundle until Launch Services
// accepts the new app. RENAME_SWAP leaves a launchable bundle at the original path.
#import <AppKit/AppKit.h>
#import <sys/file.h>
#import <sys/stat.h>
#import <signal.h>
#import <mach/machine.h>
#import <stdio.h>
#import <unistd.h>

static BOOL launch(NSString *path) {
    NSURL *url = [NSURL fileURLWithPath:path isDirectory:YES];
    NSWorkspaceOpenConfiguration *config = [NSWorkspaceOpenConfiguration configuration];
    config.createsNewApplicationInstance = YES;
    config.environment = NSProcessInfo.processInfo.environment;
    __block BOOL done = NO, success = NO;
    [NSWorkspace.sharedWorkspace openApplicationAtURL:url configuration:config
        completionHandler:^(NSRunningApplication *app, NSError *error) {
            success = app != nil;
            if (error) NSLog(@"Moss update launch: %@", error);
            done = YES;
        }];
    while (!done) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    return success;
}

int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc == 3 && strcmp(argv[1], "--verify-architecture") == 0) {
            NSBundle *bundle = [NSBundle bundleWithPath:[NSString stringWithUTF8String:argv[2]]];
#if defined(__arm64__)
            NSNumber *arch = @(CPU_TYPE_ARM64);
#else
            NSNumber *arch = @(CPU_TYPE_X86_64);
#endif
            return [bundle.executableArchitectures containsObject:arch] ? 0 : 1;
        }
        if (argc != 5) return 2;
        pid_t parent = atoi(argv[1]);
        NSString *target = [NSString stringWithUTF8String:argv[2]];
        NSString *stage = [NSString stringWithUTF8String:argv[3]];
        NSString *replacement = [stage stringByAppendingPathComponent:@"Moss.app"];
        if (![target.pathExtension isEqual:@"app"] ||
            ![stage.lastPathComponent hasPrefix:@".moss-update-"] ||
            ![stage.stringByDeletingLastPathComponent isEqual:target.stringByDeletingLastPathComponent]) return 2;
        for (int i = 0; i < 100 && kill(parent, 0) == 0; ++i) usleep(100000);
        if (kill(parent, 0) == 0) {
            NSLog(@"Moss update cancelled because the app is still running");
            [NSFileManager.defaultManager removeItemAtPath:stage error:NULL];
            return 3;
        }
        const char *installed = target.fileSystemRepresentation;
        const char *next = replacement.fileSystemRepresentation;
        int fd = open(installed, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        struct stat before;
        if (fd < 0 || flock(fd, LOCK_EX) || lstat(installed, &before) ||
            before.st_ino != strtoull(argv[4], NULL, 10)) {
            NSLog(@"Moss update could not lock the original installation");
            [NSFileManager.defaultManager removeItemAtPath:stage error:NULL];
            return 4;
        }
        BOOL swapped = renamex_np(installed, next, RENAME_SWAP) == 0;
        if (!swapped) perror("Moss update swap");
        if (!swapped || !launch(target)) {
            if (swapped && renamex_np(installed, next, RENAME_SWAP)) {
                perror("Moss update rollback");
                return 5; // Preserve both copies for recovery.
            }
            launch(target);
        }
        NSError *error = nil;
        [NSFileManager.defaultManager removeItemAtPath:stage error:&error];
        if (error) NSLog(@"Moss update cleanup: %@", error);
    }
    return 0;
}
