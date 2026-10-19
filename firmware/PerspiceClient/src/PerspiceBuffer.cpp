#include "PerspiceBuffer.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

namespace {
// capacity × itemBytes, or nullptr when it would overflow size_t (16 bits on AVR, where
// 1000 × 96 would wrap to a small block and the slots would run past it).
char* allocate(uint16_t capacity, uint16_t itemBytes) {
  if (capacity == 0 || itemBytes == 0 || capacity > SIZE_MAX / itemBytes) return nullptr;
  return static_cast<char*>(malloc(static_cast<size_t>(capacity) * itemBytes));
}
}  // namespace

PerspiceBuffer::PerspiceBuffer(uint16_t capacity, uint16_t itemBytes)
    : data_(allocate(capacity, itemBytes)), capacity_(data_ ? capacity : 0), itemBytes_(itemBytes) {}

PerspiceBuffer::~PerspiceBuffer() { free(data_); }

bool PerspiceBuffer::push(const char* msg) {
  size_t len = strlen(msg);
  if (capacity_ == 0 || len + 1 > itemBytes_) return false;
  if (count_ == capacity_) {
    head_ = (head_ + 1) % capacity_;
    count_--;
    dropped_++;
  }
  uint16_t tail = (head_ + count_) % capacity_;
  memcpy(slot(tail), msg, len + 1);
  count_++;
  return true;
}

bool PerspiceBuffer::peekAt(uint16_t index, char* out, size_t outBytes) const {
  if (index >= count_) return false;
  const char* item = slot((head_ + index) % capacity_);
  size_t len = strlen(item);
  if (len + 1 > outBytes) return false;
  memcpy(out, item, len + 1);
  return true;
}

bool PerspiceBuffer::pop() {
  if (count_ == 0) return false;
  head_ = (head_ + 1) % capacity_;
  count_--;
  return true;
}
