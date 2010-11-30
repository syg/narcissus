function test() {
    var x = <HL>true;
    var y = true;
    var z = true;
    y = <HL>!y;
    if (x)
        y = false;
    z = <HL>!z;
    if (!y)
        z = false;
    return !z;
}
test();
