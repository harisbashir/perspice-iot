// Host-compiled test for the offline ring buffer (no Arduino dependencies). Run from the repo root:
//   g++ -std=c++17 -I firmware/PerspiceClient/src firmware/test/buffer_test.cpp
//       firmware/PerspiceClient/src/PerspiceBuffer.cpp -o /tmp/bt && /tmp/bt
#include <cstdio>
#include <cstring>
#include <string>

#include "PerspiceBuffer.h"

static int failures = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);       \
      failures++;                                                       \
    }                                                                   \
  } while (0)

static std::string item(int i) { return "{\"values\":{\"n\":" + std::to_string(i) + "}}"; }

int main() {
  {
    PerspiceBuffer buf(64, 64);
    CHECK(buf.empty());
    for (int i = 0; i < 70; i++) buf.push(item(i).c_str());
    CHECK(buf.size() == 64);
    CHECK(buf.dropped() == 6);

    char out[64];
    for (int i = 6; i < 70; i++) {
      CHECK(buf.peek(out, sizeof(out)));
      CHECK(item(i) == out);
      CHECK(buf.pop());
    }
    CHECK(buf.empty());
    CHECK(!buf.pop());
    CHECK(!buf.peek(out, sizeof(out)));
  }
  {
    // Messages longer than an item slot are rejected rather than truncated into invalid JSON.
    PerspiceBuffer buf(4, 16);
    CHECK(!buf.push("this message is far too long for the slot"));
    CHECK(buf.empty());
    CHECK(buf.push("short"));
    char tiny[3];
    CHECK(!buf.peek(tiny, sizeof(tiny)));  // output buffer too small
  }
  {
    // Wrap-around keeps FIFO order.
    PerspiceBuffer buf(3, 16);
    char out[16];
    buf.push("a");
    buf.push("b");
    buf.pop();
    buf.push("c");
    buf.push("d");
    buf.push("e");  // drops "b"
    CHECK(buf.peekAt(2, out, sizeof(out)) && std::strcmp(out, "e") == 0);
    CHECK(!buf.peekAt(3, out, sizeof(out)));
    const char* expected[] = {"c", "d", "e"};
    for (const char* e : expected) {
      CHECK(buf.peek(out, sizeof(out)) && std::strcmp(out, e) == 0);
      buf.pop();
    }
  }
  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("buffer_test: all passed\n");
  return 0;
}
