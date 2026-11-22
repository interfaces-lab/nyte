#include "notifyhub/checksum.h"

unsigned int notifyhub_checksum(const char* data, unsigned int length) {
  unsigned int hash = 2166136261u;
  for (unsigned int i = 0; i < length; ++i) {
    hash ^= (unsigned char)data[i];
    hash *= 16777619u;
  }
  return hash;
}
