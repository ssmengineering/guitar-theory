"""The opt-out from Windows power throttling, checked on the process that runs the test."""

import sys
import unittest

from songimport.perf import (
    PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    prefer_performance,
    throttling_state,
)


class Performance(unittest.TestCase):
    def test_opts_out_of_throttling(self):
        note = prefer_performance()
        if sys.platform != "win32":
            self.assertIsNone(note)
            self.assertIsNone(throttling_state())
            return
        self.assertIsNotNone(note)
        self.assertIn("performance cores", note)
        state = throttling_state()
        self.assertIsNotNone(state)
        control, enabled = state
        # Execution speed is now under the process's control, and throttling is off.
        self.assertTrue(control & PROCESS_POWER_THROTTLING_EXECUTION_SPEED)
        self.assertFalse(enabled & PROCESS_POWER_THROTTLING_EXECUTION_SPEED)

    def test_is_harmless_to_repeat(self):
        self.assertEqual(prefer_performance(), prefer_performance())


if __name__ == "__main__":
    unittest.main()
