#include "pty_spawn.h"
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#include <util.h>

static void report_and_exit(int fd, int code) {
  int value = errno;
  ssize_t ignored = write(fd, &value, sizeof value);
  (void)ignored;
  _exit(code);
}

pid_t pty_spawn(int master, int slave, const char *path, char *const argv[], char *const envp[], const char *cwd,
                int *spawn_errno) {
  struct rlimit lim;
  int maxfd = getrlimit(RLIMIT_NOFILE, &lim) == 0 && lim.rlim_cur < 65536 ? (int)lim.rlim_cur : 65536;
  int report[2];
  if (pipe(report) != 0) {
    *spawn_errno = errno;
    return -1;
  }
  fcntl(report[0], F_SETFD, FD_CLOEXEC);
  fcntl(report[1], F_SETFD, FD_CLOEXEC);
  pid_t pid = fork();
  if (pid < 0) {
    *spawn_errno = errno;
    close(report[0]);
    close(report[1]);
    return -1;
  }
  if (pid == 0) {
    sigset_t none;
    sigemptyset(&none);
    sigprocmask(SIG_SETMASK, &none, NULL);
    for (int s = 1; s < NSIG; s++) signal(s, SIG_DFL);
    if (login_tty(slave) != 0) report_and_exit(report[1], 126);
    for (int fd = 3; fd < maxfd; fd++) {
      if (fd != report[1]) close(fd);
    }
    (void)master;
    if (cwd) {
      int ignored = chdir(cwd);
      (void)ignored;
    }
    execve(path, argv, envp);
    report_and_exit(report[1], 127);
  }
  close(report[1]);
  int child_errno = 0;
  ssize_t count;
  do {
    count = read(report[0], &child_errno, sizeof child_errno);
  } while (count < 0 && errno == EINTR);
  close(report[0]);
  if (count == (ssize_t)sizeof child_errno) {
    int status;
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
    }
    *spawn_errno = child_errno;
    return -1;
  }
  *spawn_errno = 0;
  return pid;
}
