function test() {
    var x = <HT>true;
    var y = true;
    var z = true;
    if (x)
        y = false;
    if (!y)
        z = false;
    return !z;
}
test();
