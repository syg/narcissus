function test() {
    var x = <HH>true;
    var y;
    if (declassify(x, <LH>)) {
        y = false;
    }
}
test();
