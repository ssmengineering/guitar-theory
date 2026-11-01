"""Ask Windows for the fast cores.

Windows 11 decides on its own that a process nobody is looking at is
background work, and on a hybrid chip (performance cores beside efficient
ones) it then runs that process on the efficient cores alone: a separation
that takes six minutes on the fast cores took twenty behind a console window
in the background. The cure is to say so. A process can opt out of power
throttling, after which the scheduler treats it as foreground work wherever
its window is. Nothing here matters on another operating system, and on a
chip with one kind of core it changes nothing.
"""

from __future__ import annotations

import ctypes
import sys

PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1
PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1
# PROCESS_INFORMATION_CLASS.ProcessPowerThrottling
PROCESS_POWER_THROTTLING_INFORMATION = 4
ABOVE_NORMAL_PRIORITY_CLASS = 0x8000


class _PowerThrottlingState(ctypes.Structure):
    _fields_ = [
        ("Version", ctypes.c_ulong),
        ("ControlMask", ctypes.c_ulong),
        ("StateMask", ctypes.c_ulong),
    ]


def _kernel32() -> ctypes.WinDLL:  # type: ignore[name-defined]
    k = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
    k.GetCurrentProcess.restype = ctypes.c_void_p
    k.GetProcessInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    k.SetProcessInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    k.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    return k


def throttling_state() -> tuple[int, int] | None:
    """This process's (ControlMask, StateMask), or None off Windows or when it cannot be read."""
    if sys.platform != "win32":
        return None
    k = _kernel32()
    state = _PowerThrottlingState(PROCESS_POWER_THROTTLING_CURRENT_VERSION, 0, 0)
    ok = k.GetProcessInformation(
        k.GetCurrentProcess(),
        PROCESS_POWER_THROTTLING_INFORMATION,
        ctypes.byref(state),
        ctypes.sizeof(state),
    )
    return (state.ControlMask, state.StateMask) if ok else None


def prefer_performance() -> str | None:
    """
    Opt this process out of power throttling and lift its priority a notch.
    Returns a line for the log, or None where there is nothing to do.
    """
    if sys.platform != "win32":
        return None
    k = _kernel32()
    handle = k.GetCurrentProcess()
    state = _PowerThrottlingState(
        PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        0,
    )
    opted = bool(
        k.SetProcessInformation(
            handle, PROCESS_POWER_THROTTLING_INFORMATION, ctypes.byref(state), ctypes.sizeof(state)
        )
    )
    if not opted:
        error = ctypes.get_last_error()
        return (
            f"could not opt out of power throttling (Windows error {error}); "
            "an import behind a background window may run on the efficient cores only"
        )
    raised = bool(k.SetPriorityClass(handle, ABOVE_NORMAL_PRIORITY_CLASS))
    return "running on the performance cores" + ("" if raised else " (priority unchanged)")
