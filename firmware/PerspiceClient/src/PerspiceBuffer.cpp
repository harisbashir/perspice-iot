#include "PerspiceBuffer.h"

#include <stdlib.h>
#include <string.h>

PerspiceBuffer::PerspiceBuffer(uint16_t capacity, uint16_t itemBytes)
    : data_(static_cast<char*>(malloc(static_cast<size_t>(capacity) * itemBytes))),
      capacity_(data_ ? capacity : 0),
      itemBytes_(itemBytes) {}

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
