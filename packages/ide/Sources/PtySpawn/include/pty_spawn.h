#include <sys/types.h>

pid_t pty_spawn(int master, int slave, const char *path, char *const argv[], char *const envp[], const char *cwd,
                int *spawn_errno);
